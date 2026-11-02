'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'modules/auth.js'), 'utf8');
const defaultBase = source.match(/IPTV_DEFAULT_BASE = '([^']+)'/)[1];
const valid = JSON.stringify({ user_info: { auth: 1, status: 'Active' } });
const reverse = value => value.split('').reverse().join('');
const wrapped = value => reverse(btoa(btoa(reverse(value)) + '|105'));

function loadAuth(body, proxy = false, status = 200) {
  const requests = [];
  const saved = [];
  const context = {
    window: { IPTV_PROXY: proxy }, atob, setTimeout, clearTimeout,
    Storage: { saveAuth: credentials => saved.push(credentials) },
    XMLHttpRequest: class {
      open(method, url) { requests.push(url); }
      send() {
        this.readyState = 4;
        this.status = status;
        this.responseText = body;
        this.onreadystatechange();
      }
      abort() {}
    }
  };
  vm.runInNewContext(source, context);
  return { auth: context.Auth, requests, saved };
}

test('default server stays consistent and login credentials are prefilled', () => {
  for (const file of ['modules/api.js', 'server.js']) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(content.match(/IPTV_DEFAULT_BASE = '([^']+)'/)[1], defaultBase);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const serverInput = html.match(/<input id="xtream-server"[^>]*>/)[0];
  assert.doesNotMatch(serverInput, /\bvalue=/);
  for (const field of ['user', 'pass']) {
    const input = html.match(new RegExp('<input id="xtream-' + field + '"[^>]*>'))[0];
    assert.match(input, /\bvalue="[^"]+"/);
  }
});

for (const [format, body] of Object.entries({ json: valid, base64: btoa(valid), legacy: '=' + btoa(valid), wrapped: wrapped(valid) })) {
  test('login accepts ' + format + ' responses', async () => {
    const { auth, saved } = loadAuth(body);
    assert.equal((await auth.loginXtream('', 'test-user', 'test-password')).success, true);
    assert.equal(saved.length, 1);
    assert.equal(auth.getCredentials().server, defaultBase);
  });
}

test('local API proxy preserves parameters and leaves custom servers and M3U alone', async () => {
  const { auth, requests } = loadAuth(valid, true);
  await auth.loginXtream('', 'test user', 'pass&word');
  assert.equal(requests[0], '/iptv/player_api.php?username=test%20user&password=pass%26word&usuario=test%20user&senha=pass%26word');
  await auth.loginXtream(' custom.invalid/ ', 'user', 'pass');
  assert.match(requests[1], /^http:\/\/custom\.invalid\/player_api\.php\?/);
  await auth._fetchText(defaultBase + '/get.php?type=m3u');
  assert.equal(requests[2], defaultBase + '/get.php?type=m3u');
});

test('static hosting keeps direct requests and accepts auth as a string', async () => {
  const { auth, requests } = loadAuth('{"user_info":{"auth":"1"}}');
  assert.equal((await auth.loginXtream('', 'user', 'pass')).success, true);
  assert.ok(requests[0].startsWith(defaultBase + '/player_api.php?'));
});

test('invalid responses and denied credentials never create a session', async () => {
  for (const body of ['', '{}', '[]', '<html>error</html>', '{"user_info":{}}', '{"user_info":{"auth":0}}', '{"user_info":{"auth":"0"}}', wrapped('{"user_info":{"auth":0}}')]) {
    const { auth, saved } = loadAuth(body);
    const result = await auth.loginXtream('', 'user', 'pass');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.equal(saved.length, 0);
    assert.equal(auth.getCredentials(), null);
  }
});

test('encoded catalogs use the same parser and preserve the item limit', async () => {
  const { auth } = loadAuth(wrapped('[{"name":"one"},{"name":"two"}]'));
  const batches = [];
  const items = await auth._fetchJSONStream(defaultBase + '/player_api.php?action=test', batch => batches.push(batch), 1);
  assert.equal(items.length, 1);
  assert.equal(batches[0][0].name, 'one');
});

test('network failures give local-server instructions without exposing credentials', async () => {
  const { auth } = loadAuth('', false, 0);
  const result = await auth.loginXtream('', 'private-user', 'private-password');
  assert.equal(result.success, false);
  assert.match(result.error, /node server\.js/);
  assert.doesNotMatch(result.error, /private-/);
});
