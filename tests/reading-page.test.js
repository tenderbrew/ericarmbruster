// Synthetic data only. Exercise the real hydration script without external assets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'reading.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(script => script.includes("fetch('reading-data.json')"));
assert.equal(scripts.length, 1, 'exactly one real reading hydration script must be tested');

function element(tag) {
  return {
    tag, children: [], attributes: {}, style: {}, textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

async function render(cover) {
  const nodes = {};
  const book = {
    title: 'Synthetic Current Book', author: 'Synthetic Author',
    link: 'https://www.goodreads.com/book/show/101', cover,
    rating: 0, readAt: null, addedAt: '2026-10-01', shelf: 'currently-reading',
  };
  const data = {
    fetchedAt: '2026-10-01T12:00:00Z',
    profileUrl: 'https://www.goodreads.com/user/show/123-synthetic',
    currentlyReading: [book], read: [], toRead: [],
  };
  const document = {
    createElement: element,
    createTextNode: value => ({tag: '#text', textContent: value, children: []}),
    getElementById: id => (nodes[id] ||= element(id)),
  };
  vm.runInNewContext(scripts[0], {
    document,
    fetch: async url => {
      assert.equal(url, 'reading-data.json');
      return {ok: true, json: async () => data};
    },
  }, {timeout: 1000});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.main?.attributes['data-hydrated'], 'reading');
  assert.equal(nodes['rd-current'].children.length, 1);
  return {figure: nodes['rd-current'].children[0], book};
}

function descendants(node, tag) {
  return [node, ...node.children.flatMap(child => descendants(child, '*'))]
    .filter(child => tag === '*' || child.tag === tag);
}

test('coverless currently-reading book has a safe clickable title', async () => {
  const {figure, book} = await render(null);
  const anchors = descendants(figure, 'a');
  assert.equal(anchors.length, 1, 'coverless title must remain clickable');
  assert.equal(anchors[0].textContent, book.title);
  assert.equal(anchors[0].href, book.link);
  assert.equal(anchors[0].target, '_blank');
  assert.equal(anchors[0].rel, 'noopener');
  assert.equal(descendants(figure, 'img').length, 0);
});

test('existing covered card keeps its linked cover and caption', async () => {
  const {figure, book} = await render('https://i.gr-assets.com/synthetic-cover.jpg');
  const anchors = descendants(figure, 'a');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].href, book.link);
  assert.equal(anchors[0].className, 'cover-link');
  const images = descendants(figure, 'img');
  assert.equal(images.length, 1);
  assert.equal(images[0].src, book.cover);
  const captions = descendants(figure, 'figcaption');
  assert.equal(captions.length, 1);
  assert.equal(captions[0].children[0].tag, 'span');
  assert.equal(captions[0].children[0].textContent, book.title);
});
