#!/usr/bin/env python3
"""Offline, allowlisted Goodreads CSV merge. No downloads and no private logs.

An existing valid snapshot is mandatory: this is not a replacement/deletion tool.
Only explicitly supplied rows update books; missing books and metadata survive.
"""
import argparse
import copy
import csv
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import unicodedata
from urllib.parse import urlsplit

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / 'reading-data.json'
PARTITIONS = {'currently-reading': 'currentlyReading', 'read': 'read', 'to-read': 'toRead'}
TOP_KEYS = {'fetchedAt', 'profileUrl', *PARTITIONS.values()}
BOOK_KEYS = {'title', 'author', 'link', 'cover', 'rating', 'readAt', 'addedAt', 'shelf'}
REQUIRED_HEADERS = {'Book Id', 'Title', 'Author', 'My Rating', 'Date Read',
                    'Date Added', 'Bookshelves', 'Exclusive Shelf'}
EXCLUDED = re.compile(r'\bForever\s+Fairies\b', re.IGNORECASE)
BOOK_PATH = re.compile(r'/book/show/([1-9][0-9]*)(?:[.-][^/]+)?/?')
REVIEW_PATH = re.compile(r'/review/show/([1-9][0-9]*)/?')


class InvalidInput(ValueError):
    """Safe diagnostic: messages must never interpolate source values."""


def require(condition, message):
    if not condition:
        raise InvalidInput(message)


def text(value):
    return isinstance(value, str) and bool(value.strip()) and not any(
        ord(char) < 32 and char not in '\t\r\n' for char in value)


def identity(book):
    # Normalize only for matching; do not normalize the published title/author.
    return tuple(' '.join(unicodedata.normalize('NFKC', book[key]).casefold().split())
                 for key in ('title', 'author'))


def safe_url(value, hosts=None):
    if not isinstance(value, str) or not value or any(char.isspace() for char in value):
        return False
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username
                and not parsed.password and parsed.port in (None, 443)
                and (hosts is None or parsed.hostname in hosts))
    except ValueError:
        return False


def book_id(book):
    match = BOOK_PATH.fullmatch(urlsplit(book['link']).path)
    return match.group(1) if match else None


def validate_snapshot(data):
    require(isinstance(data, dict) and set(data) == TOP_KEYS, 'Invalid snapshot keys.')
    stamp = data['fetchedAt']
    require(isinstance(stamp, str) and bool(re.fullmatch(
        r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', stamp)),
        'Invalid snapshot timestamp.')
    datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    require(safe_url(data['profileUrl'], {'www.goodreads.com', 'goodreads.com'})
            and bool(re.fullmatch(r'/user/show/[1-9][0-9]*(?:-[^/]*)?/?',
                                 urlsplit(data['profileUrl']).path)), 'Invalid profile URL.')
    seen_links = set()
    for shelf, partition in PARTITIONS.items():
        require(isinstance(data[partition], list), 'Invalid snapshot partition.')
        for book in data[partition]:
            require(isinstance(book, dict) and set(book) == BOOK_KEYS, 'Invalid book keys.')
            require(text(book['title']) and text(book['author']), 'Invalid book text.')
            require(book['shelf'] == shelf, 'Snapshot shelf does not match partition.')
            require(type(book['rating']) is int and 0 <= book['rating'] <= 5,
                    'Invalid snapshot rating.')
            for key in ('readAt', 'addedAt'):
                value = book[key]
                require(value is None or (isinstance(value, str) and bool(re.fullmatch(
                    r'\d{4}-\d{2}-\d{2}', value))), 'Invalid snapshot date.')
                if value is not None:
                    date.fromisoformat(value)
            require(safe_url(book['link'], {'www.goodreads.com', 'goodreads.com'}),
                    'Invalid book URL.')
            require(BOOK_PATH.fullmatch(urlsplit(book['link']).path)
                    or REVIEW_PATH.fullmatch(urlsplit(book['link']).path), 'Invalid book URL path.')
            require(book['cover'] is None or safe_url(book['cover']), 'Invalid cover URL.')
            identifier = book_id(book)
            review_match = REVIEW_PATH.fullmatch(urlsplit(book['link']).path)
            if identifier is not None:
                link_key = ('book', identifier)
            else:
                require(review_match is not None, 'Invalid review identifier.')
                assert review_match is not None
                link_key = ('review', review_match.group(1))
            require(link_key not in seen_links, 'Duplicate snapshot identifier.')
            seen_links.add(link_key)
    return data


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key.')
        result[key] = value
    return result


def load_snapshot(path):
    require(not path.is_symlink() and path.is_file(),
            'Output must be an existing regular, non-symlink snapshot.')
    original = path.read_bytes()
    data = json.loads(original.decode('utf-8'), object_pairs_hook=reject_duplicate_keys)
    return original, validate_snapshot(data)


def unquote_number(value):
    value = value.strip()
    # Goodreads uses spreadsheet-style ="..." wrappers. Never evaluate formulas.
    if value.startswith('="') and value.endswith('"'):
        value = value[2:-1]
    elif value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    return value


def csv_date(value):
    value = value.strip()
    if not value:
        return None
    require(bool(re.fullmatch(r'\d{4}([/-])\d{2}\1\d{2}', value)), 'Invalid CSV date.')
    return date.fromisoformat(value.replace('/', '-')).isoformat()


def parse_csv(path):
    books = {}
    names = {}
    count = 0
    with path.open('r', encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle, strict=True)
        headers = reader.fieldnames
        require(headers is not None and len(headers) == len(set(headers))
                and REQUIRED_HEADERS.issubset(headers) and all(text(h) for h in headers),
                'Missing, duplicate or invalid CSV headers.')
        for row in reader:
            count += 1
            require(None not in row and all(value is not None for value in row.values()),
                    'CSV row width does not match header.')
            identifier = unquote_number(row['Book Id'])
            require(bool(re.fullmatch(r'[0-9]+', identifier)) and int(identifier) > 0,
                    'Invalid CSV book identifier.')
            identifier = str(int(identifier))
            require(text(row['Title']) and text(row['Author']), 'Missing or invalid CSV title/author.')
            rating = row['My Rating'].strip()
            require(bool(re.fullmatch('[0-5]', rating)), 'Invalid CSV rating.')
            shelf = row['Exclusive Shelf'].strip()
            require(shelf in PARTITIONS, 'Unknown or missing exclusive shelf.')
            standard_shelves = {s.strip() for s in row['Bookshelves'].split(',')} & PARTITIONS.keys()
            require(standard_shelves <= {shelf}, 'Conflicting CSV shelves.')
            # ISBNs are checked, but never emitted, fetched or used as an uncertain identity.
            for key, pattern in [('ISBN', r'[0-9]{9}[0-9Xx]'), ('ISBN13', r'[0-9]{13}')]:
                isbn = unquote_number(row.get(key, ''))
                require(not isbn or bool(re.fullmatch(pattern, isbn)), 'Invalid CSV ISBN format.')
            book = {'title': row['Title'].strip(), 'author': row['Author'].strip(),
                    'link': 'https://www.goodreads.com/book/show/' + identifier,
                    'cover': None, 'rating': int(rating), 'readAt': csv_date(row['Date Read']),
                    'addedAt': csv_date(row['Date Added']), 'shelf': shelf}
            require(identifier not in books or books[identifier] == book,
                    'Conflicting duplicate CSV identifier.')
            name = identity(book)
            require(name not in names or names[name] == identifier,
                    'Ambiguous duplicate CSV title/author.')
            books[identifier] = book
            names[name] = identifier
    require(count > 0, 'CSV contains no book rows; refusing import.')
    # Validate even excluded rows, but remove them before any shelf partitioning.
    return [book for book in books.values() if not EXCLUDED.search(book['title'])]


def merge_snapshot(previous, incoming):
    data = copy.deepcopy(previous)
    # Apply exclusion to retained data too; an omitted excluded book cannot survive a merge.
    existing = [book for partition in PARTITIONS.values() for book in data[partition]
                if not EXCLUDED.search(book['title'])]
    by_id = {book_id(book): book for book in existing if book_id(book)}
    by_name = {}
    for book in existing:
        by_name.setdefault(identity(book), []).append(book)
    matched = set()
    new_books = []
    for fresh in incoming:
        old = by_id.get(book_id(fresh))
        if old is None:
            candidates = by_name.get(identity(fresh), [])
            require(len(candidates) <= 1, 'Ambiguous existing title/author match.')
            # Do not overwrite a known, different edition ID on a title-only match.
            old = candidates[0] if candidates and book_id(candidates[0]) is None else None
        if old is None:
            new_books.append(fresh)
            continue
        require(id(old) not in matched, 'Multiple CSV rows match one existing book.')
        matched.add(id(old))
        # Keep review URLs (not book IDs!), known covers and missing dates. CSV has no covers.
        updated = dict(fresh, link=old['link'], cover=old['cover'],
                       readAt=fresh['readAt'] or old['readAt'],
                       addedAt=fresh['addedAt'] or old['addedAt'])
        old.update(updated)
    # Stable order: retained/matched books in original order, new books in export order.
    all_books = existing + new_books
    for shelf, partition in PARTITIONS.items():
        data[partition] = [book for book in all_books
                           if not EXCLUDED.search(book['title']) and book['shelf'] == shelf]
    validate_snapshot(data)
    return data


def atomic_write(path, original, data):
    temporary = None
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n',
                                         dir=path.parent, prefix='.reading-', suffix='.tmp',
                                         delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write('\n')
            handle.flush()
            os.chmod(temporary, mode)
            os.fsync(handle.fileno())
        # Fail closed on edits made while parsing; never replace a newly introduced symlink.
        require(not path.is_symlink() and path.read_bytes() == original,
                'Snapshot changed during import; retry after reviewing local edits.')
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--csv', type=Path, help='Explicit private Goodreads export path (local only).')
    source.add_argument('--validate', action='store_true', help='Validate the existing snapshot only.')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT,
                        help='Existing snapshot to merge into (default: repository reading-data.json).')
    parser.add_argument('--check', action='store_true', help='Validate/preview merge without writing.')
    args = parser.parse_args(argv)
    if args.validate and args.check:
        parser.error('--check requires --csv')
    try:
        original, previous = load_snapshot(args.output)
        if args.validate:
            require(not any(EXCLUDED.search(book['title'])
                            for partition in PARTITIONS.values() for book in previous[partition]),
                    'Snapshot contains an excluded title; import/filter before publishing.')
            print('Snapshot contract valid; no data refreshed or written.')
            return 0
        require(args.csv.resolve() != args.output.resolve(), 'CSV and output paths must differ.')
        data = merge_snapshot(previous, parse_csv(args.csv))
        changed = data != previous
        if not changed:
            print('No data change; snapshot bytes and fetchedAt preserved.')
        elif args.check:
            print('Valid merge would change snapshot; no files written.')
        else:
            data['fetchedAt'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            atomic_write(args.output, original, data)
            print('Snapshot updated atomically; review the JSON diff before publishing.')
        return 0
    except InvalidInput as error:
        print(str(error) + ' No snapshot written.', file=sys.stderr)
        return 1
    except (OSError, ValueError, csv.Error, OverflowError):
        # Parser/OS exceptions may contain source cells or private file paths. Do not log them.
        print('Import/validation failed; check paths, CSV headers/rows, identities and snapshot contract. '
              'No snapshot written.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
