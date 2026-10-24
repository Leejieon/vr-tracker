// VR core logic (pure functions). Shared by the page and the node test.
var DAY = 86400000;
function parseDate(s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function fmtDate(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function addDays(s, n) { return fmtDate(parseDate(s) + n * DAY); }
function cycleIndexFor(startDate, dateStr) {
  var n = Math.floor((parseDate(dateStr) - parseDate(startDate)) / (14 * DAY)) + 1;
  return n < 1 ? 1 : n;
}
function cycleStartDate(startDate, n) { return addDays(startDate, 14 * (n - 1)); }

function modeDefaults(mode) {
  if (mode === 'withdraw') return { G: 20, poolLimit: 25 };
  if (mode === 'lump') return { G: 10, poolLimit: 50 };
  return { G: 10, poolLimit: 75 };
}

// Rebuild cycles 1..upTo from settings + trades.
// V_next = V + poolEnd / G + c   (c: +contribution, -withdrawal, 0 for lump)
// pool_next = poolEnd + c
function buildLedger(st, upTo) {
  var s = st.settings, rows = [];
  var V = s.v1, pool = s.pool0, shares = s.shares0;
  var c = s.mode === 'accumulate' ? s.amount : s.mode === 'withdraw' ? -s.amount : 0;
  for (var n = 1; n <= upTo; n++) {
    var buyQty = 0, sellQty = 0, buyCost = 0, sellIn = 0;
    st.trades.forEach(function (t) {
      if (cycleIndexFor(s.startDate, t.date) !== n) return;
      if (t.side === 'buy') { buyQty += t.qty; buyCost += t.qty * t.price; }
      else { sellQty += t.qty; sellIn += t.qty * t.price; }
    });
    var poolEnd = pool - buyCost + sellIn;
    var sharesEnd = shares + buyQty - sellQty;
    var row = {
      n: n, start: cycleStartDate(s.startDate, n), end: addDays(cycleStartDate(s.startDate, n), 13),
      V: V, min: V * (1 - s.bandLow / 100), max: V * (1 + s.bandHigh / 100),
      poolStart: pool, sharesStart: shares, buyQty: buyQty, sellQty: sellQty,
      buyCost: buyCost, sellIn: sellIn, poolEnd: poolEnd, sharesEnd: sharesEnd, c: c,
      nextV: V + poolEnd / s.G + c, nextPool: poolEnd + c,
      budget: pool * s.poolLimit / 100
    };
    rows.push(row);
    V = row.nextV; pool = row.nextPool; shares = sharesEnd;
  }
  return rows;
}

// One-share-per-level reservation ladder (assumption, see UI note).
// buy level k: Vmin / (S + k - 1); sell level k: Vmax / (S - k + 1)
function buyLadder(minBand, shares, budget, poolCap, maxRows) {
  var out = [], cost = 0, limit = Math.min(budget, poolCap);
  for (var k = 1; k <= (maxRows || 40); k++) {
    var price = Math.floor(minBand / (shares + k - 1) * 100) / 100;
    if (!(price > 0)) break;
    if (cost + price > limit + 1e-9) break;
    cost += price;
    out.push({ k: k, price: price, cum: cost });
  }
  return out;
}
function sellLadder(maxBand, shares, maxRows) {
  var out = [], cum = 0;
  for (var k = 1; k <= Math.min(shares, maxRows || 40); k++) {
    var price = Math.ceil(maxBand / (shares - k + 1) * 100) / 100;
    cum += price;
    out.push({ k: k, price: price, cum: cum });
  }
  return out;
}

function zoneFor(evalAmt, min, max) {
  if (evalAmt <= min) return 'buy';
  if (evalAmt >= max) return 'sell';
  return 'hold';
}

var TASK_OFFSET = { record: 11, calc: 12, orderFrom: 12, orderDue: 14 };

function cycleEnded(row, today) {
  return today > row.end;
}

// Last bar inside each ended cycle's [start, end] window, keyed by cycle number.
function pickCycleCloses(rows, bars, today) {
  var out = {};
  rows.forEach(function (r) {
    if (!cycleEnded(r, today)) return;
    var best = null;
    bars.forEach(function (b) {
      if (b.date >= r.start && b.date <= r.end && (!best || b.date > best.date)) best = b;
    });
    if (best) out[r.n] = { price: best.close, date: best.date };
  });
  return out;
}

if (typeof module !== "undefined") module.exports = { parseDate: parseDate, fmtDate: fmtDate, addDays: addDays, cycleIndexFor: cycleIndexFor, cycleStartDate: cycleStartDate, modeDefaults: modeDefaults, buildLedger: buildLedger, buyLadder: buyLadder, sellLadder: sellLadder, zoneFor: zoneFor, TASK_OFFSET: TASK_OFFSET, cycleEnded: cycleEnded, pickCycleCloses: pickCycleCloses };

