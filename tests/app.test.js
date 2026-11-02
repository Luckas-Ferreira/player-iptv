'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function loadApp(hostname, port, proxy = false) {
  const redirects = [];
  const initialized = new Error('Normal app initialization reached');
  const context = {
    window: {
      IPTV_PROXY: proxy,
      location: { hostname, port, replace: address => redirects.push(address) }
    },
    document: { readyState: 'loading', addEventListener() {} },
    Player: { init() { throw initialized; } }
  };
  vm.runInNewContext(source, context);
  return { app: context.App, redirects, initialized };
}

test('local Live Server redirects before starting the app or sending credentials', () => {
  for (const hostname of ['127.0.0.1', 'localhost']) {
    const { app, redirects } = loadApp(hostname, '5500');
    app.init();
    assert.deepEqual(redirects, ['http://127.0.0.1:8080/']);
  }
});

test('proxy hosting, direct files and other origins keep normal initialization', () => {
  for (const [hostname, port, proxy] of [
    ['127.0.0.1', '8080', true], ['127.0.0.1', '5500', true],
    ['', '', false], ['example.invalid', '5500', false],
    ['127.0.0.1', '9000', false]
  ]) {
    const { app, redirects, initialized } = loadApp(hostname, port, proxy);
    assert.throws(() => app.init(), error => error === initialized);
    assert.deepEqual(redirects, []);
  }
});

test('login uses only Xtream without tabs and keeps validation, click and Enter working', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.doesNotMatch(html, /id="(?:tab-xtream|tab-m3u|form-m3u|m3u-url)"|role="tabpanel"/);

  const events = {};
  const calls = [];
  const controls = {
    'xtream-server': { value: '' },
    'xtream-user': { value: 'test-user' },
    'xtream-pass': { value: 'test-password' },
    'btn-connect': {},
    'login-status': {}
  };
  for (const id of ['xtream-server', 'xtream-user', 'xtream-pass', 'btn-connect']) {
    controls[id].addEventListener = (event, handler) => { events[id + ':' + event] = handler; };
  }
  const context = {
    window: { IPTV_PROXY: true },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: id => controls[id] || null,
      querySelectorAll: selector => selector === '.login-form input'
        ? [controls['xtream-server'], controls['xtream-user'], controls['xtream-pass']] : []
    },
    Player: { init() {} },
    Navigation: { init() {}, pushHistory() {}, setScreen() {}, focusFirst() {} },
    Auth: {
      restoreSession() { return false; },
      loginXtream(...credentials) { calls.push(credentials); return Promise.resolve({ success: true }); }
    },
    setTimeout() {}
  };
  vm.runInNewContext(source, context);
  context.App.init();

  for (const field of ['xtream-user', 'xtream-pass']) {
    const value = controls[field].value;
    controls[field].value = '';
    events['btn-connect:click']();
    assert.equal(calls.length, 0);
    assert.equal(controls['login-status'].className, 'login-status error');
    controls[field].value = value;
  }

  events['btn-connect:click']();
  events['btn-connect:click']();
  assert.deepEqual(calls, [['', 'test-user', 'test-password']]);
  await Promise.resolve();
  assert.equal(controls['login-status'].className, 'login-status success');

  events['xtream-pass:keydown']({ keyCode: 13 });
  await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.equal(controls['login-status'].className, 'login-status success');
});
