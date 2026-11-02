'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const server = require('../server');

function mockUpstream(context, status = 200) {
  return context.mock.method(http, 'get', (url, callback) => {
    const request = new EventEmitter();
    request.setTimeout = milliseconds => assert.equal(milliseconds, 120000);
    request.destroy = () => {};
    setImmediate(() => {
      const response = new PassThrough();
      response.statusCode = status;
      response.headers = { 'content-type': 'text/plain', location: 'http://untrusted.invalid' };
      callback(response);
      response.end('provider-response');
    });
    return request;
  });
}

test('local server', async context => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  await context.test('serves the app with the local proxy enabled', async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /window\.IPTV_PROXY = true/);
    const script = await fetch(base + '/modules/auth.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
  });

  await context.test('does not serve private files or accept writes', async () => {
    for (const pathname of ['/.git/config', '/server.js', '/tests/auth.test.js', '/%2e%2e/server.js', '/iptv/get.php']) {
      assert.equal((await fetch(base + pathname)).status, 404);
    }
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    const response = await fetch(base + '/styles.css', { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  });

  await context.test('forwards only the configured API and preserves encoded query parameters', async subtest => {
    const mocked = mockUpstream(subtest);
    const query = '?username=test%20user&password=pass%26word';
    const response = await fetch(base + '/iptv/player_api.php' + query);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'provider-response');
    assert.equal(mocked.mock.calls[0].arguments[0], 'http://191.96.78.246/player_api.php' + query);
    assert.equal(response.headers.get('location'), null);
  });

  await context.test('refuses upstream redirects instead of leaking credentials to another host', async subtest => {
    mockUpstream(subtest, 302);
    const response = await fetch(base + '/iptv/player_api.php?username=test&password=secret');
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('location'), null);
  });

  await context.test('preserves provider HTTP errors', async subtest => {
    mockUpstream(subtest, 401);
    const response = await fetch(base + '/iptv/player_api.php');
    assert.equal(response.status, 401);
  });

  await context.test('handles connection failures without exposing the requested URL', async subtest => {
    subtest.mock.method(http, 'get', () => {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = () => {};
      setImmediate(() => request.emit('error', new Error('private-password')));
      return request;
    });
    const response = await fetch(base + '/iptv/player_api.php?password=private-password');
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private-password/);
  });
});
