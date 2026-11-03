'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../modules/renderer.js'), 'utf8');

function loadRenderer() {
  const timers = new Map();
  const images = [];
  let timerId = 0;
  const document = { activeElement: null };
  function element(tag) {
    return {
      tagName: tag.toUpperCase(), children: [], attributes: {}, style: {}, className: '', parentNode: null,
      set innerHTML(value) { assert.equal(value, ''); for (const child of this.children) child.parentNode = null; this.children = []; },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      appendChild(child) {
        if (child.tagName === 'FRAGMENT') { for (const entry of [...child.children]) this.appendChild(entry); return child; }
        child.parentNode = this; this.children.push(child); return child;
      },
      querySelector(selector) { return this.children.find(child => selector === '.card' && child.className.startsWith('card ')); },
      addEventListener() {},
      focus() { document.activeElement = this; }
    };
  }
  const controls = Object.fromEntries(['content-grid', 'content-body', 'catalogue-prev', 'catalogue-next', 'catalogue-page'].map(id => [id, element('div')]));
  document.getElementById = id => controls[id] || null;
  document.createElement = element;
  document.createDocumentFragment = () => element('fragment');
  document.documentElement = { contains(node) { while (node) { if (node === controls['content-grid']) return true; node = node.parentNode; } return false; } };
  const context = {
    document, window: {}, Storage: { getProgress() { return null; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Image: class { constructor() { images.push(this); } }
  };
  vm.runInNewContext(source, context);
  return {
    renderer: context.Renderer, controls, document, images,
    processImages() {
      for (const [id, timer] of timers) {
        if (timer.delay !== 100) continue;
        timers.delete(id); timer.callback(); break;
      }
    }
  };
}

test('catalog pages keep at most 12 cards and allow returning to earlier titles', () => {
  const { renderer, controls, document } = loadRenderer();
  const grid = controls['content-grid'];
  const items = Array.from({ length: 29 }, (_, index) => ({ stream_id: index + 1, name: 'Channel ' + (index + 1) }));
  renderer.Pager.init(grid);
  renderer.Pager.append(items.slice(0, 15));
  renderer.Pager.append(items.slice(15));
  assert.equal(grid.children.length, 12);
  assert.equal(controls['catalogue-page'].textContent, 'P\u00e1gina 1 de 3');
  assert.equal(controls['catalogue-prev'].disabled, true);
  controls['catalogue-next'].onclick();
  assert.equal(grid.children.length, 12);
  assert.equal(grid.children[0].attributes['aria-label'], 'Channel 13');
  assert.equal(document.activeElement, grid.children[0]);
  controls['catalogue-next'].onclick();
  assert.equal(grid.children.length, 5);
  assert.equal(controls['catalogue-next'].disabled, true);
  controls['catalogue-prev'].onclick();
  controls['catalogue-prev'].onclick();
  assert.equal(grid.children[0].attributes['aria-label'], 'Channel 1');
  renderer.destroyVirtualScroll();
  assert.equal(controls['catalogue-next'].onclick, null);
  assert.equal(controls['catalogue-next'].disabled, true);
});

test('progressive chunks preserve existing cards and remote focus', () => {
  const { renderer, controls, document } = loadRenderer();
  const grid = controls['content-grid'];
  const items = Array.from({ length: 15 }, (_, index) => ({ stream_id: index + 1, name: 'Channel ' + (index + 1) }));
  renderer.Pager.init(grid);
  renderer.Pager.append(items.slice(0, 3));
  const focused = grid.children[1];
  focused.focus();
  renderer.Pager.append(items.slice(3));
  assert.equal(grid.children.length, 12);
  assert.equal(grid.children[1], focused);
  assert.equal(document.activeElement, focused);
  controls['catalogue-next'].onclick();
  const lastPageCard = grid.children[0];
  renderer.Pager.append([{ stream_id: 16, name: 'Channel 16' }]);
  assert.equal(grid.children.length, 4);
  assert.equal(grid.children[0], lastPageCard);
  assert.equal(document.activeElement, lastPageCard);
});

test('image requests are limited to two and are cancelled when changing pages', () => {
  const { renderer, controls, images, processImages } = loadRenderer();
  renderer.Pager.init(controls['content-grid']);
  renderer.Pager.append(Array.from({ length: 25 }, (_, index) => ({ stream_id: index + 1, name: 'Channel', stream_icon: 'http://images.invalid/' + index })));
  processImages();
  assert.equal(images.length, 2);
  controls['catalogue-next'].onclick();
  assert.ok(images.every(image => image.src === '' && image.onload === null && image.onerror === null));
  processImages();
  assert.equal(images.length, 4);
  renderer.destroyVirtualScroll();
  assert.ok(images.every(image => image.src === '' && image.onload === null));
});
