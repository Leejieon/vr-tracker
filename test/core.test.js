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

test('task offsets match the checklist', function () {
  assert.deepStrictEqual(vr.TASK_OFFSET, { record: 11, calc: 12, orderFrom: 12, orderDue: 14 });
});
test('cycleEnded uses the day after the end date', function () {
  var r = vr.buildLedger(state(), 1)[0];               // 2026-01-05 .. 2026-01-18
  assert.strictEqual(vr.cycleEnded(r, '2026-01-18'), false);
  assert.strictEqual(vr.cycleEnded(r, '2026-01-19'), true);
});
test('pickCycleCloses takes the last bar inside each ended cycle', function () {
  var rows = vr.buildLedger(state(), 3);                // cycles start 01-05, 01-19, 02-02
  var bars = [
    { date: '2026-01-16', close: 50 }, { date: '2026-01-15', close: 49 },
    { date: '2026-01-29', close: 55 },                  // 01-30 holiday: Thursday wins
    { date: '2026-02-03', close: 60 }                   // cycle 3 not ended
  ];
  assert.deepStrictEqual(vr.pickCycleCloses(rows, bars, '2026-02-04'), {
    1: { price: 50, date: '2026-01-16' }, 2: { price: 55, date: '2026-01-29' }
  });
});
test('pickCycleCloses leaves a cycle without bars empty', function () {
  var rows = vr.buildLedger(state(), 2);
  assert.deepStrictEqual(vr.pickCycleCloses(rows, [{ date: '2026-01-30', close: 55 }], '2026-02-04'), { 2: { price: 55, date: '2026-01-30' } });
});

test('buildIcs makes three biweekly 8am events with alarms', function () {
  var ics = vr.buildIcs(state().settings, 'https://leejieon.github.io/vr-tracker/');
  var lines = ics.split('\r\n');
  assert.strictEqual(lines[0], 'BEGIN:VCALENDAR');
  assert.strictEqual(ics.match(/BEGIN:VEVENT/g).length, 3);
  assert.strictEqual(ics.match(/RRULE:FREQ=WEEKLY;INTERVAL=2/g).length, 3);
  assert.ok(lines.indexOf('DTSTART;TZID=Asia/Seoul:20260116T080000') >= 0);   // 01-05 + 11
  assert.ok(lines.indexOf('DTEND;TZID=Asia/Seoul:20260116T083000') >= 0);
  assert.ok(lines.indexOf('DTSTART;TZID=Asia/Seoul:20260117T080000') >= 0);   // +12
  assert.ok(lines.indexOf('UID:vr-record-2026-01-05@leejieon.github.io') >= 0);
  assert.ok(lines.indexOf('SUMMARY:VR 새 V값 확인 · 적립금 입금') >= 0);
  assert.strictEqual(ics.match(/TRIGGER:PT0M/g).length, 3);
  assert.ok(lines.every(function (l) { return Buffer.byteLength(l) <= 75; }));
});
test('buildIcs: lump mode has no cash suffix, withdraw says 인출금', function () {
  assert.ok(vr.buildIcs(state({ mode: 'lump' }).settings, 'x').indexOf('SUMMARY:VR 새 V값 확인\r\n') >= 0);
  assert.ok(vr.buildIcs(state({ mode: 'withdraw' }).settings, 'x').indexOf('인출금 반영') >= 0);
});
test('buildIcs escapes commas and semicolons', function () {
  var ics = vr.buildIcs(state({ ticker: 'A,B;C' }).settings, 'x');
  assert.ok(ics.indexOf('A\\,B\\;C') >= 0);
});

test('cycleNote has frontmatter numbers for Bases and a trade table', function () {
  var st = state();
  st.trades.push({ date: '2026-01-07', side: 'buy', qty: 2, price: 80, memo: '예약|1번째\n추가' });
  var row = vr.buildLedger(st, 1)[0];
  var md = vr.cycleNote(row, st.trades, { price: 85.5, date: '2026-01-16' }, 'TQQQ');
  var expectHead = ['---', 'tags: [투자, VR]', '사이클: 1', '시작일: 2026-01-05', '종료일: 2026-01-18', '종목: TQQQ',
    'V: 10000', '최소밴드: 8500', '최대밴드: 11500', '시작Pool: 3000.00', '끝Pool: 2840.00', '보유수량: 102',
    '종가: 85.5', '종가일: 2026-01-16', '평가금: 8721', '다음V: 10534', '---'];
  assert.deepStrictEqual(md.split('\n').slice(0, expectHead.length), expectHead);
  assert.ok(md.indexOf('# VR 사이클 1 (1/5–1/18)') >= 0);
  assert.ok(md.indexOf('매수 2주 · 매도 0주') >= 0);
  assert.ok(md.indexOf('| 2026-01-07 | 매수 | 2 | 80.00 | 160.00 | 예약\\|1번째 추가 |') >= 0);
  assert.ok(md.trim().endsWith('관련: [[밸류 리밸런싱]]'));
});
test('cycleNote without trades says so', function () {
  var row = vr.buildLedger(state(), 1)[0];
  assert.ok(vr.cycleNote(row, [], { price: 50, date: '2026-01-16' }, 'TQQQ').indexOf('체결 없음') >= 0);
});
test('noteFileName', function () { assert.strictEqual(vr.noteFileName(5), 'VR 사이클 5.md'); });
test('cycleNote escapes backslash before pipe in memo', function () {
  var st = state();
  st.trades.push({ date: '2026-01-07', side: 'buy', qty: 1, price: 80, memo: 'a\\|b' });
  var row = vr.buildLedger(st, 1)[0];
  var md = vr.cycleNote(row, st.trades, { price: 85.5, date: '2026-01-16' }, 'TQQQ');
  var line = md.split('\n').filter(function (l) { return l.indexOf('| 2026-01-07 |') === 0; })[0];
  assert.ok(line.indexOf('| a\\\\\\|b |') >= 0);
  assert.strictEqual(line.replace(/\\./g, '').split('|').length - 1, 7);
});
