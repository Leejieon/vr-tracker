// Run: node --test test/*.test.js
var test = require('node:test');
var assert = require('node:assert');
var vr = require('../js/core.js');

function state(over) {
  var s = Object.assign({ mode: 'accumulate', G: 10, bandLow: 15, bandHigh: 15, poolLimit: 75, amount: 250, startDate: '2026-01-05', v1: 10000, pool0: 3000, shares0: 100, ticker: 'TQQQ' }, over);
  return { settings: s, trades: [], prices: {}, checks: {} };
}

test('cycles are 14 days and start at 1', function () {
  assert.strictEqual(vr.cycleIndexFor('2026-01-05', '2026-01-04'), 1);
  assert.strictEqual(vr.cycleIndexFor('2026-01-05', '2026-01-18'), 1);
  assert.strictEqual(vr.cycleIndexFor('2026-01-05', '2026-01-19'), 2);
  assert.strictEqual(vr.cycleStartDate('2026-01-05', 3), '2026-02-02');
});

test('mode defaults', function () {
  assert.deepStrictEqual(vr.modeDefaults('accumulate'), { G: 10, poolLimit: 75 });
  assert.deepStrictEqual(vr.modeDefaults('lump'), { G: 10, poolLimit: 50 });
  assert.deepStrictEqual(vr.modeDefaults('withdraw'), { G: 20, poolLimit: 25 });
});

test('next V = V + pool/G + contribution, bands from V', function () {
  var r = vr.buildLedger(state(), 2);
  assert.strictEqual(r[0].min, 8500);
  assert.strictEqual(r[0].max, 11500);
  assert.strictEqual(r[0].nextV, 10000 + 3000 / 10 + 250);
  assert.strictEqual(r[1].V, 10550);
  assert.strictEqual(r[1].poolStart, 3250);
  assert.strictEqual(r[0].budget, 2250);
});

test('withdraw subtracts, lump adds nothing', function () {
  assert.strictEqual(vr.buildLedger(state({ mode: 'withdraw', G: 20 }), 1)[0].nextV, 10000 + 3000 / 20 - 250);
  assert.strictEqual(vr.buildLedger(state({ mode: 'lump' }), 1)[0].nextPool, 3000);
});

test('trades move pool and shares within their cycle', function () {
  var st = state();
  st.trades.push({ date: '2026-01-07', side: 'buy', qty: 2, price: 80 });
  st.trades.push({ date: '2026-01-21', side: 'sell', qty: 1, price: 120 });
  var r = vr.buildLedger(st, 2);
  assert.strictEqual(r[0].poolEnd, 2840);
  assert.strictEqual(r[0].sharesEnd, 102);
  assert.strictEqual(r[1].sharesEnd, 101);
  assert.strictEqual(r[1].poolEnd, 2840 + 250 + 120);
});

test('buy ladder stays within budget and pool', function () {
  var l = vr.buyLadder(8500, 100, 200, 3000, 40);
  assert.strictEqual(l[0].price, 85);
  assert.strictEqual(l[1].price, 84.15);
  assert.ok(l[l.length - 1].cum <= 200);
  assert.strictEqual(vr.buyLadder(8500, 100, 10, 3000, 40).length, 0);
});

test('sell ladder rounds up and is capped by shares', function () {
  var l = vr.sellLadder(11500, 100, 40);
  assert.strictEqual(l[0].price, 115);
  assert.strictEqual(l[1].price, 116.17);
  assert.strictEqual(vr.sellLadder(11500, 3, 40).length, 3);
});

test('zone', function () {
  assert.strictEqual(vr.zoneFor(8000, 8500, 11500), 'buy');
  assert.strictEqual(vr.zoneFor(10000, 8500, 11500), 'hold');
  assert.strictEqual(vr.zoneFor(12000, 8500, 11500), 'sell');
});
