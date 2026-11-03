'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('only the latest stream list is cached, and clearing releases it', async () => {
  const calls = [];
  const context = {
    Auth: {
      getCredentials() { return { type: 'xtream', server: 'http://provider.invalid', username: 'test', password: 'test' }; },
      _fetchJSON(url) { calls.push(url); return Promise.resolve([{ stream_id: calls.length, name: 'Channel' }]); },
      _fetchJSONStream(url, onChunk) { calls.push(url); const items = [{ stream_id: calls.length, name: 'Channel' }]; onChunk(items); return Promise.resolve(items); }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../modules/api.js'), 'utf8'), context);
  const api = context.API;
  const first = await api.getLiveStreams('one');
  assert.equal((await api.getLiveStreams('one'))[0], first[0]);
  assert.equal(calls.length, 1);
  let chunk;
  await api.getLiveStreams('two', items => { chunk = items; });
  assert.equal(chunk[0]._type, 'live');
  assert.equal(calls.length, 2);
  await api.getLiveStreams('one');
  assert.equal(calls.length, 3);
  api.clearCache();
  await api.getLiveStreams('one');
  assert.equal(calls.length, 4);
});
