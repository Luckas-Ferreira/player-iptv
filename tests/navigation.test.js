'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../modules/navigation.js'), 'utf8');

function loadNavigation() {
  const handlers = {};
  const controls = {};
  const document = { activeElement: null, body: {}, addEventListener(name, handler) { handlers[name] = handler; }, getElementById: id => controls[id] || null };
  let backCount = 0;
  function button(owner, top, className) {
    return {
      tagName: 'BUTTON', disabled: false, clicks: 0, className,
      getBoundingClientRect() { return { left: 10, right: 110, top, width: 100, height: 50 }; },
      closest(selector) { return selector === '.' + className ? this : selector === '#' + owner.id ? owner : null; },
      getAttribute() { return 'Selected title'; },
      focus() { document.activeElement = this; handlers.focus({ target: this }); },
      click() { this.clicks++; },
      scrollIntoView() {}
    };
  }
  function screen(id, className, count) {
    const container = {
      id, hidden: id === 'modal-resume',
      contains(node) { return this.buttons.includes(node); },
      querySelectorAll() { return this.buttons; },
      querySelector(selector) { return selector === '.' + className ? this.buttons[0] : null; }
    };
    container.classList = { contains() { return container.hidden; }, add() { container.hidden = true; } };
    container.buttons = Array.from({ length: count }, (_, index) => button(container, 20 + index * 80, className));
    controls[id] = container;
    return container;
  }
  const home = screen('screen-home', 'home-tile', 2);
  const main = screen('screen-main', 'card', 1);
  const modal = screen('modal-resume', 'resume-action', 2);
  controls['focused-item-name'] = {};
  const context = {
    document, window: { innerWidth: 1280, getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; } },
    App: { goBack() { backCount++; } }, setTimeout(callback) { callback(); }
  };
  vm.runInNewContext(source, context);
  context.Navigation.init();
  context.Navigation.setScreen('home');
  return {
    navigation: context.Navigation, home, main, modal, document, controls,
    backCount: () => backCount,
    key(keyCode, defaultPrevented = false) { handlers.keydown({ keyCode, defaultPrevented, preventDefault() { this.defaultPrevented = true; } }); }
  };
}

test('already handled OK events do not activate a tile twice', () => {
  const { navigation, home, key } = loadNavigation();
  navigation.focusFirst('home');
  key(13, true);
  assert.equal(home.buttons[0].clicks, 0);
  key(13);
  assert.equal(home.buttons[0].clicks, 1);
});

test('returning restores focus, ignores disabled items and updates the selected title', () => {
  const { navigation, home, main, document, controls } = loadNavigation();
  home.buttons[1].focus();
  navigation.setScreen('main');
  navigation.focusFirst('main');
  assert.equal(document.activeElement, main.buttons[0]);
  assert.equal(controls['focused-item-name'].textContent, 'Selected title');
  navigation.setScreen('home');
  navigation.focusFirst('home');
  assert.equal(document.activeElement, home.buttons[1]);
  home.buttons[1].disabled = true;
  navigation.focusFirst('home');
  assert.equal(document.activeElement, home.buttons[0]);
  home.buttons[1].disabled = false;
  home.buttons[1].focus();
  navigation.clearHistory();
  navigation.focusFirst('home');
  assert.equal(document.activeElement, home.buttons[0]);
});

test('remote focus stays inside the resume dialog and Back closes only the dialog', () => {
  const { navigation, home, modal, document, key, backCount } = loadNavigation();
  home.buttons[1].focus();
  modal.hidden = false;
  modal.buttons[0].focus();
  key(40);
  assert.equal(document.activeElement, modal.buttons[1]);
  key(40);
  assert.equal(document.activeElement, modal.buttons[1]);
  key(27);
  assert.equal(modal.hidden, true);
  assert.equal(document.activeElement, home.buttons[1]);
  assert.equal(backCount(), 0);
  navigation.focusFirst('home');
  key(27);
  assert.equal(backCount(), 1);
});
