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

// --- iCalendar export (RFC 5545) ---
function icsEscape(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsFold(line) {
  var out = [], cur = "", bytes = 0, limit = 75, chars = Array.from(line);
  for (var i = 0; i < chars.length; i++) {
    var n = chars[i].length === 1 && chars[i].charCodeAt(0) < 0x80 ? 1 : encodeURIComponent(chars[i]).replace(/%[0-9A-F]{2}/g, "x").length;
    if (bytes + n > limit) { out.push(cur); cur = " "; bytes = 1; limit = 75; }
    cur += chars[i]; bytes += n;
  }
  out.push(cur);
  return out;
}
function buildIcs(settings, appUrl) {
  var host = (/^https?:\/\/([^\/]+)/.exec(appUrl) || [])[1] || "vr-tracker";
  var calc = "VR 새 V값 확인" + (settings.mode === "accumulate" ? " · 적립금 입금" : settings.mode === "withdraw" ? " · 인출금 반영" : "");
  var head = "종목: " + settings.ticker + "\n";
  var events = [
    { key: "record", off: TASK_OFFSET.record, summary: "VR 체결 내역 기록", desc: head + "사이클 체결 내역을 앱에 기록하세요." },
    { key: "calc", off: TASK_OFFSET.calc, summary: calc, desc: head + "새 사이클의 V값을 확인하세요." },
    { key: "order", off: TASK_OFFSET.orderFrom, summary: "VR 예약 주문 (매수·매도)", desc: head + "사이클 14일째(다음 사이클 시작일)까지 주문을 걸어 두세요." }
  ];
  var stamp = new Date(Date.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//leejieon//VR Tracker//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:Asia/Seoul", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900", "TZNAME:KST", "END:STANDARD", "END:VTIMEZONE"];
  events.forEach(function (e) {
    var d = addDays(settings.startDate, e.off).replace(/-/g, "");
    L.push("BEGIN:VEVENT", "UID:vr-" + e.key + "-" + settings.startDate + "@" + host, "DTSTAMP:" + stamp,
      "DTSTART;TZID=Asia/Seoul:" + d + "T080000", "DTEND;TZID=Asia/Seoul:" + d + "T083000",
      "RRULE:FREQ=WEEKLY;INTERVAL=2", "SUMMARY:" + icsEscape(e.summary),
      "DESCRIPTION:" + icsEscape(e.desc + "\n" + appUrl),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(e.summary), "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return L.reduce(function (a, l) { return a.concat(icsFold(l)); }, []).join("\r\n") + "\r\n";
}

function noteFileName(n) { return "VR 사이클 " + n + ".md"; }

function cycleNote(row, trades, close, ticker) {
  function md(d) { var p = d.split("-"); return Number(p[1]) + "/" + Number(p[2]); }
  var sorted = trades.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var out = ["---", "tags: [투자, VR]", "사이클: " + row.n, "시작일: " + row.start, "종료일: " + row.end, "종목: " + ticker,
    "V: " + Math.round(row.V), "최소밴드: " + Math.round(row.min), "최대밴드: " + Math.round(row.max),
    "시작Pool: " + row.poolStart.toFixed(2), "끝Pool: " + row.poolEnd.toFixed(2), "보유수량: " + row.sharesEnd,
    "종가: " + close.price, "종가일: " + close.date, "평가금: " + Math.round(row.sharesEnd * close.price),
    "다음V: " + Math.round(row.nextV), "---", "",
    "# VR 사이클 " + row.n + " (" + md(row.start) + "–" + md(row.end) + ")", "",
    "매수 " + row.buyQty + "주 · 매도 " + row.sellQty + "주", ""];
  if (!sorted.length) {
    out.push("체결 없음");
  } else {
    out.push("| 날짜 | 구분 | 수량 | 가격 | 금액 | 메모 |", "|---|---|---|---|---|---|");
    sorted.forEach(function (t) {
      var memo = String(t.memo || "").replace(/\r?\n/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      out.push("| " + t.date + " | " + (t.side === "buy" ? "매수" : "매도") + " | " + t.qty + " | " + t.price.toFixed(2) + " | " + (t.qty * t.price).toFixed(2) + " | " + memo + " |");
    });
  }
  out.push("", "관련: [[밸류 리밸런싱]]", "");
  return out.join("\n");
}

if (typeof module !== "undefined") module.exports = { parseDate: parseDate, fmtDate: fmtDate, addDays: addDays, cycleIndexFor: cycleIndexFor, cycleStartDate: cycleStartDate, modeDefaults: modeDefaults, buildLedger: buildLedger, buyLadder: buyLadder, sellLadder: sellLadder, zoneFor: zoneFor, TASK_OFFSET: TASK_OFFSET, cycleEnded: cycleEnded, pickCycleCloses: pickCycleCloses, buildIcs: buildIcs, noteFileName: noteFileName, cycleNote: cycleNote };

