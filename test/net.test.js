var test = require('node:test');
var assert = require('node:assert');
var Net = require('../js/net.js');

function fake(responses) {
  var calls = [];
  var i = 0;
  var f = function (url, init) {
    calls.push({ url: url, init: init });
    var r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (r === 'throw') return Promise.reject(new Error('net'));
    return Promise.resolve({ status: r[0], ok: r[0] >= 200 && r[0] < 300, json: function () { return Promise.resolve(r[1]); } });
  };
  f.calls = calls;
  return f;
}

test('quote ok', async function () {
  var f = fake([[200, { close: '66.80', last_quote_at: 1792785540 }]]);
  var r = await Net.fetchQuote('K', 'TQQQ', f);
  assert.deepStrictEqual(r, { ok: true, price: 66.8, at: 1792785540000 });
  assert.ok(f.calls[0].url.indexOf('symbol=TQQQ') >= 0);
  assert.ok(f.calls[0].url.indexOf('apikey=K') >= 0);
});

test('quote error in 200 body', async function () {
  var r = await Net.fetchQuote('K', 'X', fake([[200, { status: 'error', code: 401 }]]));
  assert.deepStrictEqual(r, { ok: false, reason: 'auth' });
  r = await Net.fetchQuote('K', 'X', fake([[200, { status: 'error', code: 429 }]]));
  assert.deepStrictEqual(r, { ok: false, reason: 'limit' });
});

test('quote missing close', async function () {
  var r = await Net.fetchQuote('K', 'X', fake([[200, {}]]));
  assert.deepStrictEqual(r, { ok: false, reason: 'error' });
});

test('no key', async function () {
  var f = fake([[200, {}]]);
  var r = await Net.fetchQuote('', 'X', f);
  assert.deepStrictEqual(r, { ok: false, reason: 'nokey' });
  assert.strictEqual(f.calls.length, 0);
});

test('fetch throws', async function () {
  var r = await Net.fetchQuote('K', 'X', fake(['throw']));
  assert.deepStrictEqual(r, { ok: false, reason: 'offline' });
});

test('bars', async function () {
  var f = fake([[200, { values: [{ datetime: '2026-01-16', close: '50.1' }], status: 'ok' }]]);
  var r = await Net.fetchDailyBars('K', 'TQQQ', '2026-01-05', '2026-02-04', f);
  assert.deepStrictEqual(r, { ok: true, bars: [{ date: '2026-01-16', close: 50.1 }] });
  assert.ok(f.calls[0].url.indexOf('start_date=2026-01-05&end_date=2026-02-04') >= 0);
});

test('b64utf8', function () {
  assert.strictEqual(Net.b64utf8('VR 사이클'), Buffer.from('VR 사이클').toString('base64'));
});

var cfg = { token: 'T', repo: 'Leejieon/obsidian-vault', branch: 'main' };
var PATH = 'wiki/투자/VR/사이클 기록/VR 사이클 1.md';
var URL = 'https://api.github.com/repos/Leejieon/obsidian-vault/contents/wiki/%ED%88%AC%EC%9E%90/VR/%EC%82%AC%EC%9D%B4%ED%81%B4%20%EA%B8%B0%EB%A1%9D/VR%20%EC%82%AC%EC%9D%B4%ED%81%B4%201.md';

test('putVaultFile new file', async function () {
  var f = fake([[404, {}], [201, {}]]);
  var r = await Net.putVaultFile(cfg, PATH, 'hi', 'msg', f);
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(f.calls[1].url, URL);
  assert.strictEqual(f.calls[1].init.method, 'PUT');
  var body = JSON.parse(f.calls[1].init.body);
  assert.strictEqual(body.sha, undefined);
  assert.strictEqual(body.branch, 'main');
  assert.strictEqual(body.message, 'msg');
  assert.strictEqual(f.calls[1].init.headers.Authorization, 'Bearer T');
});

test('putVaultFile existing', async function () {
  var f = fake([[200, { sha: 'abc' }], [200, {}]]);
  var r = await Net.putVaultFile(cfg, PATH, 'hi', 'msg', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(JSON.parse(f.calls[1].init.body).sha, 'abc');
});

test('putVaultFile conflict retries once', async function () {
  var f = fake([[200, { sha: 'a' }], [409, {}], [200, { sha: 'b' }], [200, {}]]);
  var r = await Net.putVaultFile(cfg, PATH, 'hi', 'msg', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.calls.length, 4);
  assert.strictEqual(JSON.parse(f.calls[3].init.body).sha, 'b');
});

test('putVaultFile 401 and empty token', async function () {
  var r = await Net.putVaultFile(cfg, PATH, 'hi', 'msg', fake([[401, {}]]));
  assert.deepStrictEqual(r, { ok: false, reason: 'auth' });
  var f = fake([[200, {}]]);
  r = await Net.putVaultFile({ token: '', repo: 'a/b', branch: 'main' }, PATH, 'hi', 'm', f);
  assert.deepStrictEqual(r, { ok: false, reason: 'nokey' });
  assert.strictEqual(f.calls.length, 0);
});
