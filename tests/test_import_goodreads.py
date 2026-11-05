"""Synthetic inputs only; never load or modify the site's reading-data.json."""
import csv
import importlib.util
import json

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools' / 'import_goodreads.py'
HEADERS = ['Book Id', 'Title', 'Author', 'My Rating', 'Date Read', 'Date Added',
           'Bookshelves', 'Exclusive Shelf', 'ISBN', 'ISBN13', 'My Review', 'Private Notes']


def row(**changes):
    value = dict(zip(HEADERS, ['101', 'Synthetic Book', 'Synthetic Author', '4',
                     '2026/10/01', '2026/09/01', '', 'read', '="0306406152"',
                     '="9780306406157"', 'PRIVATE REVIEW', 'PRIVATE NOTE']))
    value.update(changes)
    return value


def book(title='Existing Book', shelf='currently-reading', link=None):
    return {'title': title, 'author': 'Synthetic Author',
            'link': link or 'https://www.goodreads.com/review/show/77',
            'cover': 'https://i.gr-assets.com/existing.jpg', 'rating': 0,
            'readAt': None, 'addedAt': '2026-09-01', 'shelf': shelf}


def baseline():
    return {'fetchedAt': '2026-10-01T12:00:00Z',
            'profileUrl': 'https://www.goodreads.com/user/show/123-synthetic',
            'currentlyReading': [book()], 'read': [], 'toRead': []}


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.output = self.directory / 'data.json'
        self.source = self.directory / 'private.csv'
        self.write_data(baseline())

    def write_data(self, value):
        self.output.write_text(json.dumps(value, indent=4) + '\n', encoding='utf-8')

    def csv(self, rows, headers=HEADERS, bom=False):
        with self.source.open('w', encoding='utf-8-sig' if bom else 'utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)

    def run_cli(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                                text=True, capture_output=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('PRIVATE NOTE', result.stdout + result.stderr)
        self.assertNotIn('PRIVATE REVIEW', result.stdout + result.stderr)
        return result

    def import_csv(self, rows=None, **kwargs):
        if rows is not None:
            self.csv(rows, **kwargs)
        return self.run_cli('--csv', self.source, '--output', self.output)

    def data(self):
        return json.loads(self.output.read_text(encoding='utf-8'))

    def assert_rejected(self, rows=None, raw=None):
        if rows is not None:
            self.csv(rows)
        if raw is not None:
            self.source.write_text(raw, encoding='utf-8')
        before = self.output.read_bytes()
        stamp = self.output.stat().st_mtime_ns
        self.run_cli('--csv', self.source, '--output', self.output, ok=False)
        self.assertEqual(self.output.read_bytes(), before)
        self.assertEqual(self.output.stat().st_mtime_ns, stamp)
        self.assertEqual(sorted(p.name for p in self.directory.iterdir()), ['data.json', 'private.csv'])

    def test_bom_multiline_commas_and_private_allowlist(self):
        self.import_csv([row(Title='Synthetic,\nBook', **{'Book Id': '="00101"'})], bom=True)
        data = self.data()
        self.assertEqual(data['read'][0]['title'], 'Synthetic,\nBook')
        self.assertEqual(data['read'][0]['link'], 'https://www.goodreads.com/book/show/101')
        self.assertEqual(data['read'][0]['readAt'], '2026-10-01')
        self.assertEqual(data['read'][0]['rating'], 4)
        self.assertIsNone(data['read'][0]['cover'])
        self.assertEqual(set(data), set(baseline()))
        self.assertEqual(set(data['read'][0]), set(book()))
        self.assertNotIn('PRIVATE', self.output.read_text())

    def test_merge_keeps_unmatched_existing(self):
        self.import_csv([row()])
        self.assertEqual(self.data()['currentlyReading'], baseline()['currentlyReading'])
        self.assertEqual(len(self.data()['read']), 1)
        self.assertNotEqual(self.data()['fetchedAt'], baseline()['fetchedAt'])

    def test_move_preserves_review_link_cover_and_missing_dates(self):
        self.import_csv([row(Title='Existing Book', **{'Date Added': '', 'Date Read': ''})])
        value = self.data()['read'][0]
        self.assertEqual(value['link'], book()['link'])
        self.assertEqual(value['cover'], book()['cover'])
        self.assertEqual(value['addedAt'], '2026-09-01')
        self.assertEqual(self.data()['currentlyReading'], [])

    def test_match_stable_book_id_after_title_and_author_change(self):
        data = baseline()
        data['currentlyReading'][0]['link'] = 'https://www.goodreads.com/book/show/101-old-slug'
        self.write_data(data)
        self.import_csv([row(Title='New Title', Author='New Author')])
        self.assertEqual(self.data()['read'][0]['link'], data['currentlyReading'][0]['link'])
        self.assertEqual(self.data()['currentlyReading'], [])

    def test_dotted_book_slug_validates_and_matches_stable_id(self):
        data = baseline()
        data['currentlyReading'][0]['link'] = 'https://www.goodreads.com/book/show/101.Synthetic_Book'
        self.write_data(data)
        self.run_cli('--validate', '--output', self.output)
        self.import_csv([row(Title='Renamed Synthetic Book', Author='Renamed Author')])
        self.assertEqual(self.data()['currentlyReading'], [])
        self.assertEqual(len(self.data()['read']), 1)
        self.assertEqual(self.data()['read'][0]['link'], data['currentlyReading'][0]['link'])
        self.assertEqual(self.data()['read'][0]['cover'], data['currentlyReading'][0]['cover'])
        self.assertEqual(self.data()['read'][0]['title'], 'Renamed Synthetic Book')

    def test_noop_preserves_exact_bytes_timestamp_mtime_and_order(self):
        self.import_csv([row()])
        before = self.output.read_bytes()
        stamp = self.output.stat().st_mtime_ns
        self.import_csv([row()])
        self.assertEqual(self.output.read_bytes(), before)
        self.assertEqual(self.output.stat().st_mtime_ns, stamp)

    def test_csv_order_does_not_reorder_existing(self):
        rows = [row(), row(**{'Book Id': '102', 'Title': 'Another Book'})]
        self.import_csv(rows)
        before = self.output.read_bytes()
        self.import_csv(rows[::-1])
        self.assertEqual(self.output.read_bytes(), before)

    def test_identical_duplicates_are_deduplicated(self):
        self.import_csv([row(), row(**{'Private Notes': 'different ignored private field'})])
        self.assertEqual(len(self.data()['read']), 1)

    def test_conflicting_duplicate_id_fails(self):
        self.assert_rejected([row(), row(**{'My Rating': '3'})])

    def test_duplicate_title_author_different_ids_fails(self):
        self.assert_rejected([row(), row(**{'Book Id': '102'})])

    def test_exclusion_all_partitions_existing_and_imported(self):
        data = baseline()
        for index, (key, shelf) in enumerate([('currentlyReading', 'currently-reading'), ('read', 'read'), ('toRead', 'to-read')]):
            data[key].append(book('Volume: FOREVER\n Fairies ' + str(index), shelf,
                                  'https://www.goodreads.com/book/show/' + str(800 + index)))
        self.write_data(data)
        rows = [row(Title='FOREVER   FAIRIES: Synthetic ' + str(i), **{'Book Id': str(900 + i), 'Exclusive Shelf': s})
                for i, s in enumerate(['read', 'currently-reading', 'to-read'])]
        self.import_csv(rows)
        self.assertEqual(self.data()['currentlyReading'], baseline()['currentlyReading'])
        self.assertEqual(self.data()['read'], [])
        self.assertEqual(self.data()['toRead'], [])
        before = self.output.read_bytes()
        self.import_csv(rows)
        self.assertEqual(self.output.read_bytes(), before)

    def test_exclusion_word_boundaries_do_not_overmatch(self):
        self.import_csv([row(Title='Forever Fairiesque')])
        self.assertEqual(len(self.data()['read']), 1)

    def test_shelves_and_dates(self):
        for shelf, partition in [('read', 'read'), ('currently-reading', 'currentlyReading'), ('to-read', 'toRead')]:
            with self.subTest(shelf=shelf):
                self.write_data(baseline())
                self.import_csv([row(**{'Exclusive Shelf': shelf, 'Bookshelves': shelf + ', custom-shelf',
                                       'Date Read': '', 'Date Added': '2026-10-02', 'My Rating': '0'})])
                self.assertEqual(self.data()[partition][-1]['shelf'], shelf)
                self.assertIsNone(self.data()[partition][-1]['readAt'])

    def test_validation_failures_leave_output_untouched(self):
        cases = [{'Book Id': ''}, {'Book Id': '1e5'}, {'Book Id': '=SUM(1)'},
                 {'Title': ''}, {'Author': ''}, {'My Rating': '6'}, {'My Rating': '4.5'},
                 {'My Rating': ''}, {'Date Read': '2026/02/30'}, {'Date Added': '10/01/2026'},
                 {'Exclusive Shelf': ''}, {'Exclusive Shelf': 'custom'},
                 {'Bookshelves': 'read, to-read'}, {'ISBN': '="not-an-isbn"'}, {'ISBN13': '123'}]
        for changes in cases:
            with self.subTest(changes=changes):
                self.assert_rejected([row(**changes)])

    def test_empty_missing_duplicate_headers_and_malformed_csv(self):
        for raw in ['', ','.join(HEADERS) + '\n', '<html>Not an export</html>',
                    ','.join(HEADERS + ['Title']) + '\n',
                    ','.join(HEADERS) + '\n"unterminated',
                    ','.join(HEADERS) + '\n1,too,few\n',
                    ','.join(HEADERS) + '\n' + ','.join(['x'] * (len(HEADERS) + 1))]:
            with self.subTest(raw=raw[:40]):
                self.assert_rejected(raw=raw)

    def test_late_invalid_row_does_not_partially_write(self):
        self.assert_rejected([row(), row(**{'Book Id': '102', 'Title': 'Late Bad', 'Date Read': 'bad'})])

    def test_check_mode_does_not_write(self):
        self.csv([row()])
        before = self.output.read_bytes()
        result = self.run_cli('--csv', self.source, '--output', self.output, '--check')
        self.assertEqual(self.output.read_bytes(), before)
        self.assertIn('change', result.stdout.lower())

    def test_no_source_missing_source_and_missing_output_fail(self):
        self.run_cli(ok=False)
        self.run_cli('--csv', self.source, '--output', self.output, ok=False)
        self.csv([row()])
        self.run_cli('--csv', self.source, '--output', self.directory / 'missing.json', ok=False)
        self.assertFalse((self.directory / 'missing.json').exists())

    def test_validate_is_readonly_and_no_fake_refresh(self):
        before = self.output.read_bytes()
        self.run_cli('--validate', '--output', self.output)
        self.assertEqual(self.output.read_bytes(), before)
        self.run_cli('--validate', '--check', '--output', self.output, ok=False)

    def test_invalid_existing_json_or_contract_is_never_overwritten(self):
        malformed = [dict(baseline(), read='bad'), dict(baseline(), fetchedAt='bad')]
        bad_book = baseline()
        bad_book['currentlyReading'][0]['rating'] = True
        malformed.append(bad_book)
        bad_link = baseline()
        bad_link['currentlyReading'][0]['link'] = 'javascript:alert(1)'
        malformed.append(bad_link)
        for data in malformed:
            with self.subTest(data=data):
                self.write_data(data)
                self.assert_rejected([row()])
        self.output.write_text('{broken')
        self.assert_rejected([row()])

    def test_ambiguous_existing_match_fails(self):
        data = baseline()
        data['read'].append(book(shelf='read', link='https://www.goodreads.com/review/show/78'))
        self.write_data(data)
        self.assert_rejected([row(Title='Existing Book')])

    def test_symlink_target_rejected(self):
        target = self.directory / 'real.json'
        self.output.rename(target)
        self.output.symlink_to(target)
        self.csv([row()])
        before = target.read_bytes()
        self.run_cli('--csv', self.source, '--output', self.output, ok=False)
        self.assertEqual(target.read_bytes(), before)

    def load_module(self):
        spec = importlib.util.spec_from_file_location('goodreads_import', SCRIPT)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_known_different_edition_id_is_not_overwritten(self):
        data = baseline()
        data['currentlyReading'][0]['link'] = 'https://www.goodreads.com/book/show/999'
        self.write_data(data)
        self.import_csv([row(Title='Existing Book')])
        self.assertEqual(self.data()['currentlyReading'], data['currentlyReading'])
        self.assertEqual(self.data()['read'][0]['link'], 'https://www.goodreads.com/book/show/101')

    def test_id_update_does_not_absorb_a_distinct_id_with_old_title(self):
        data = baseline()
        data['currentlyReading'][0]['link'] = 'https://www.goodreads.com/book/show/101'
        self.write_data(data)
        self.import_csv([row(Title='Updated Title'),
                         row(Title='Existing Book', **{'Book Id': '102'})])
        self.assertEqual(self.data()['currentlyReading'], [])
        self.assertEqual([(b['title'], b['link']) for b in self.data()['read']],
                         [('Updated Title', 'https://www.goodreads.com/book/show/101'),
                          ('Existing Book', 'https://www.goodreads.com/book/show/102')])

    def test_review_id_is_not_mistaken_for_book_id(self):
        self.import_csv([row(**{'Book Id': '77'})])
        self.assertEqual(self.data()['currentlyReading'], baseline()['currentlyReading'])
        self.assertEqual(self.data()['read'][0]['link'], 'https://www.goodreads.com/book/show/77')

    def test_normalized_legacy_match_without_rewriting_link(self):
        self.import_csv([row(Title='  EXISTING   BOOK ', Author='synthetic author')])
        self.assertEqual(self.data()['currentlyReading'], [])
        self.assertEqual(self.data()['read'][0]['link'], book()['link'])

    def test_absent_read_date_is_preserved(self):
        data = baseline()
        data['currentlyReading'][0]['readAt'] = '2025-01-01'
        self.write_data(data)
        self.import_csv([row(Title='Existing Book', **{'Date Read': ''})])
        self.assertEqual(self.data()['read'][0]['readAt'], '2025-01-01')

    def test_excluded_invalid_row_is_still_validated(self):
        self.assert_rejected([row(Title='Forever Fairies', **{'My Rating': 'invalid'})])

    def test_validate_rejects_excluded_titles_without_writing(self):
        data = baseline()
        data['currentlyReading'][0]['title'] = 'Forever Fairies'
        self.write_data(data)
        before = self.output.read_bytes()
        self.run_cli('--validate', '--output', self.output, ok=False)
        self.assertEqual(self.output.read_bytes(), before)

    def test_invalid_utf8_input_is_rejected(self):
        self.source.write_bytes(b'\xff\xfe')
        self.assert_rejected()

    def test_duplicate_json_keys_are_rejected(self):
        self.output.write_text('{"fetchedAt": "one", "fetchedAt": "two"}')
        self.assert_rejected([row()])

    def test_invalid_fields_never_appear_in_diagnostics(self):
        self.csv([row(**{'Book Id': 'PRIVATE NOTE', 'Title': 'PRIVATE REVIEW'})])
        self.run_cli('--csv', self.source, '--output', self.output, ok=False)

    def test_atomic_write_failure_before_replace_keeps_original(self):
        module = self.load_module()
        self.csv([row()])
        before = self.output.read_bytes()
        with patch.object(module.os, 'fsync', side_effect=OSError('PRIVATE NOTE')):
            self.assertNotEqual(module.main(['--csv', str(self.source), '--output', str(self.output)]), 0)
        self.assertEqual(self.output.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.directory.iterdir()), ['data.json', 'private.csv'])

    def test_concurrent_edit_detected_and_not_overwritten(self):
        module = self.load_module()
        self.csv([row()])
        edited = self.output.read_bytes() + b'\n'
        def external_edit(_descriptor):
            self.output.write_bytes(edited)
        with patch.object(module.os, 'fsync', side_effect=external_edit):
            self.assertNotEqual(module.main(['--csv', str(self.source), '--output', str(self.output)]), 0)
        self.assertEqual(self.output.read_bytes(), edited)
        self.assertEqual(sorted(p.name for p in self.directory.iterdir()), ['data.json', 'private.csv'])

    def test_preserves_output_permissions(self):
        self.output.chmod(0o640)
        self.import_csv([row()])
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o640)

    def test_source_and_output_cannot_be_same(self):
        before = self.output.read_bytes()
        self.run_cli('--csv', self.output, '--output', self.output, ok=False)
        self.assertEqual(self.output.read_bytes(), before)

    def test_atomic_replace_failure_keeps_original_and_cleans_temp(self):
        module = self.load_module()
        self.csv([row()])
        before = self.output.read_bytes()
        with patch.object(module.os, 'replace', side_effect=OSError('synthetic failure')):
            self.assertNotEqual(module.main(['--csv', str(self.source), '--output', str(self.output)]), 0)
        self.assertEqual(self.output.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.directory.iterdir()), ['data.json', 'private.csv'])


if __name__ == '__main__':
    unittest.main()
