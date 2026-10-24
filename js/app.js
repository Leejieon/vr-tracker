(function () {
  'use strict';
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var TABS = [['today', '오늘'], ['log', '기록'], ['chart', '차트'], ['set', '설정']];
  var S = null;                       // persisted state
  var U = { tab: 'today', side: 'buy', armed: '', msg: {}, chartSel: {}, quote: {}, close: {} };   // quote/close: fetch status, never saved
  var store = { status: 'local' };
  var LS_KEY = 'vr-ledger-v1';         // old app name; kept so saved records still load
  var $app = document.getElementById('app'), $tabs = document.getElementById('tabs');

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dow(s) { return new Date(parseDate(s)).getUTCDay(); }
  function mondayOf(s) { return addDays(s, -((dow(s) + 6) % 7)); }
  function short(s) { var p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]) + '(' + WD[dow(s)] + ')'; }
  function money(n, d) { if (n == null || !isFinite(n)) return '-'; var neg = n < 0; var t = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 0 : d }); return (neg ? '-$' : '$') + t; }
  function money2(n) { return money(n, 2); }
  function int(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function num(v) { var x = parseFloat(String(v).replace(/,/g, '')); return isFinite(x) ? x : NaN; }
  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY); }

  /* ---------- demo data (in memory only, never saved) ---------- */
  function makeDemo() {
    var start = addDays(mondayOf(todayStr()), -56);
    var st = { demo: true, settings: { mode: 'accumulate', G: 10, bandLow: 15, bandHigh: 15, poolLimit: 75, amount: 250, startDate: start, v1: 9960, pool0: 3000, shares0: 166, ticker: 'TQQQ' }, trades: [], prices: {}, checks: {}, quote: null, closeMeta: {}, exported: {} };
    var path = [{ lo: 55.5, hi: 64.0, close: 58.2 }, { lo: 50.0, hi: 59.5, close: 52.4 }, { lo: 48.2, hi: 57.0, close: 56.1 }, { lo: 54.0, hi: 66.5, close: 64.3 }];
    path.forEach(function (p, i) {
      var n = i + 1, r = buildLedger(st, n)[n - 1], s0 = cycleStartDate(start, n);
      buyLadder(r.min, r.sharesStart, r.budget, r.poolStart, 40).forEach(function (l) { if (p.lo <= l.price) st.trades.push({ id: uid(), date: addDays(s0, 2), side: 'buy', qty: 1, price: l.price, memo: '예시' }); });
      sellLadder(r.max, r.sharesStart, 40).forEach(function (l) { if (p.hi >= l.price) st.trades.push({ id: uid(), date: addDays(s0, 8), side: 'sell', qty: 1, price: l.price, memo: '예시' }); });
      st.prices[n] = p.close;
    });
    st.prices[5] = 66.8;
    return st;
  }

  /* ---------- storage: localStorage on this device ---------- */
  function bodyOf(st) { return { v: 1, settings: st.settings, trades: st.trades, prices: st.prices, checks: st.checks, quote: st.quote || null, closeMeta: st.closeMeta || {}, exported: st.exported || {}, savedAt: Date.now() }; }
  function valid(b) { return b && b.settings && typeof b.settings.v1 === 'number' && Array.isArray(b.trades) && b.settings.startDate; }
  function fromBody(b) {
    var st = { demo: false, settings: b.settings, trades: b.trades, prices: b.prices || {}, checks: b.checks || {}, quote: b.quote || null, closeMeta: b.closeMeta || {}, exported: b.exported || {}, savedAt: b.savedAt || 0 };
    // Older records kept the live price in prices[current cycle]; move it to quote.
    try {
      var today = todayStr();
      if (!st.quote && today >= st.settings.startDate) {
        var n = cycleIndexFor(st.settings.startDate, today);
        if (st.prices[n] > 0) { st.quote = { price: st.prices[n], at: null, source: 'manual' }; delete st.prices[n]; }
      }
    } catch (e) {}
    return st;
  }
  var SEC_KEY = 'vr-tracker-secrets';
  function secrets() {
    var o = {};
    try { var t = localStorage.getItem(SEC_KEY); o = t ? JSON.parse(t) || {} : {}; } catch (e) { o = {}; }
    return { tdKey: o.tdKey || '', ghToken: o.ghToken || '', repo: o.repo || 'Leejieon/obsidian-vault', branch: o.branch || 'main', folder: o.folder || 'wiki/투자/VR/사이클 기록' };
  }
  function saveSecrets(o) { try { localStorage.setItem(SEC_KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }
  function lsRead() { try { var t = localStorage.getItem(LS_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function lsWrite(b) { try { localStorage.setItem(LS_KEY, JSON.stringify(b)); return true; } catch (e) { return false; } }
  function save() {
    if (!S || S.demo) return;
    S.savedAt = Date.now();
    store.status = lsWrite(bodyOf(S)) ? 'local' : 'error';
    paintSync();
  }
  function paintSync() {
    var el = document.getElementById('sync'); if (!el) return;
    var t = { local: S && S.demo ? '예시 화면' : '이 기기에 저장됨', error: '저장 실패 · 백업을 내보내세요' }[store.status];
    el.textContent = t;
  }
  function initStorage() {
    // Ask the browser not to evict our data under storage pressure.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  }
  function saveFile(name, text, type) {
    type = type || 'application/json';
    var file;
    try { file = new File([text], name, { type: type }); } catch (e) { file = null; }
    // iOS home-screen apps: the share sheet offers "파일에 저장".
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name });
    }
    var url = URL.createObjectURL(new Blob([text], { type: type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return Promise.resolve();
  }

  /* ---------- derived view model ---------- */
  function model() {
    var s = S.settings, today = todayStr();
    var before = today < s.startDate;
    var n = before ? 1 : cycleIndexFor(s.startDate, today);
    var rows = buildLedger(S, n + 1);          // includes next cycle preview
    var cur = rows[n - 1], next = rows[n];
    var price = S.demo ? S.prices[n] : (S.quote && S.quote.price > 0 ? S.quote.price : undefined);   // current cycle: live quote (demo keeps its example price)
    var held = cur.sharesEnd;                  // shares held right now
    var evalNow = price > 0 ? held * price : NaN;
    return { s: s, today: today, before: before, n: n, rows: rows, cur: cur, next: next, price: price, held: held, priceOf: function (k) { return k === n ? price : S.prices[k]; }, evalNow: evalNow, zone: isFinite(evalNow) ? zoneFor(evalNow, cur.min, cur.max) : null };
  }
  function tasksFor(m) {
    var st = m.cur.start, mode = m.s.mode, out = [];
    out.push({ key: 'close', t: '체결 내역 기록 (종가는 자동)', d: addDays(st, TASK_OFFSET.record) });
    out.push({ key: 'calc', t: '새 V값과 밴드 확인', d: addDays(st, TASK_OFFSET.calc) });
    if (mode !== 'lump') out.push({ key: 'cash', t: mode === 'withdraw' ? '인출금 Pool 반영 확인' : '적립금 Pool 입금 확인', d: addDays(st, TASK_OFFSET.calc) });
    out.push({ key: 'buy', t: '예약 매수 주문 설정', d: addDays(st, TASK_OFFSET.orderDue), from: addDays(st, TASK_OFFSET.orderFrom) });
    out.push({ key: 'sell', t: '예약 매도 주문 설정', d: addDays(st, TASK_OFFSET.orderDue), from: addDays(st, TASK_OFFSET.orderFrom) });
    out.forEach(function (x) { x.done = !!S.checks[m.n + ':' + x.key]; });
    return out;
  }
  function taskChip(x, today) {
    if (x.done) return '<span class="chip hold">완료</span>';
    var dd = daysBetween(today, x.d);
    if (dd < 0) return '<span class="chip late">' + (-dd) + '일 지남</span>';
    if (today >= (x.from || x.d)) return '<span class="chip now">' + (dd === 0 ? '오늘까지' : 'D-' + dd) + '</span>';
    return '<span class="chip hold">' + short(x.from || x.d) + '</span>';
  }

  /* ---------- charts ---------- */
  var chartCtx = {};
  function niceTicks(lo, hi, cnt) {
    var span = Math.max(hi - lo, 1e-9), raw = span / cnt, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag, out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return out;
  }
  function kfmt(v) { return Math.abs(v) >= 10000 ? '$' + (v / 1000).toFixed(0) + 'k' : Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(v); }
  function drawChart(id, cats, o) {
    var W = 360, H = 200, L = 44, R = 10, T = 10, B = 24, N = cats.length;
    var all = [];
    o.lines.forEach(function (ln) { ln.vals.forEach(function (v) { if (v != null && isFinite(v)) all.push(v); }); });
    if (o.band) { o.band.lo.forEach(function (v) { all.push(v); }); o.band.hi.forEach(function (v) { all.push(v); }); }
    if (!all.length) return '<p class="hint">표시할 데이터가 아직 없습니다.</p>';
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pd = (hi - lo) * 0.08 || hi * 0.05 || 1;
    if (o.zero) lo = Math.min(lo, 0); else lo -= pd; hi += pd;
    var ticks = niceTicks(lo, hi, 4);
    if (ticks.length) { lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]); }
    function X(i) { return N === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (N - 1); }
    function Y(v) { return T + (hi - v) / (hi - lo) * (H - T - B); }
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label) + '" id="' + id + '">';
    ticks.forEach(function (t) { g += '<line class="s-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/><text class="s-t" x="' + (L - 6) + '" y="' + (Y(t) + 3).toFixed(1) + '" text-anchor="end">' + kfmt(t) + '</text>'; });
    var every = Math.ceil(N / 7);
    cats.forEach(function (c, i) { if (i % every === 0 || i === N - 1) g += '<text class="s-t" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + c + '</text>'; });
    if (o.band && N > 1) {
      var d = 'M' + X(0).toFixed(1) + ' ' + Y(o.band.hi[0]).toFixed(1);
      for (var i = 1; i < N; i++) d += ' L' + X(i).toFixed(1) + ' ' + Y(o.band.hi[i]).toFixed(1);
      for (var j = N - 1; j >= 0; j--) d += ' L' + X(j).toFixed(1) + ' ' + Y(o.band.lo[j]).toFixed(1);
      g += '<path class="s-band" d="' + d + ' Z"/>';
    } else if (o.band) {
      g += '<rect class="s-band" x="' + (X(0) - 14) + '" width="28" y="' + Y(o.band.hi[0]).toFixed(1) + '" height="' + (Y(o.band.lo[0]) - Y(o.band.hi[0])).toFixed(1) + '"/>';
    }
    o.lines.forEach(function (ln) {
      var pts = [], d = '';
      ln.vals.forEach(function (v, i) { if (v != null && isFinite(v)) pts.push([X(i), Y(v)]); });
      pts.forEach(function (p, k) { d += (k ? ' L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); });
      if (pts.length > 1) g += '<path class="' + ln.cls + '" d="' + d + '"/>';
      else if (pts.length === 1 && !ln.dots) g += '<path class="' + ln.cls + '" d="M' + (pts[0][0] - 14).toFixed(1) + ' ' + pts[0][1].toFixed(1) + ' L' + (pts[0][0] + 14).toFixed(1) + ' ' + pts[0][1].toFixed(1) + '"/>';
      if (ln.dots) pts.forEach(function (p) { g += '<circle class="' + ln.dot + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4"/>'; });
    });
    g += '<line class="s-cross" id="' + id + '-x" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/>';
    g += '<rect x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + (H - B) + '" fill="transparent" id="' + id + '-hit"/></svg>';
    chartCtx[id] = { N: N, X: X, W: W, L: L, R: R, cb: o.readout };
    return g;
  }
  function bindChart(id) {
    var c = chartCtx[id], svg = document.getElementById(id), hit = document.getElementById(id + '-hit'), x = document.getElementById(id + '-x');
    if (!c || !svg || !hit) return;
    function pick(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * c.W, best = 0, bd = 1e9;
      for (var i = 0; i < c.N; i++) { var d = Math.abs(c.X(i) - px); if (d < bd) { bd = d; best = i; } }
      x.setAttribute('x1', c.X(best)); x.setAttribute('x2', c.X(best)); x.style.display = '';
      c.cb(best);
    }
    hit.addEventListener('pointermove', pick); hit.addEventListener('pointerdown', pick);
    hit.addEventListener('pointerleave', function () { x.style.display = 'none'; c.cb(c.N - 1); });
  }

  /* ---------- views ---------- */
  function demoBanner() {
    if (!S.demo) return '';
    return '<div class="banner"><p><b>예시 데이터</b>입니다. 숫자는 가상이며 저장되지 않습니다. 내 설정으로 시작하면 이 화면이 내 기록으로 바뀝니다.</p><button class="btn primary small" data-act="tab" data-v="set">내 설정으로 시작</button></div>';
  }
  var REASON = { nokey: '설정에서 Twelve Data 키를 넣으면 자동으로 채워집니다', auth: 'Twelve Data 키를 확인하세요', limit: '요청이 많아요. 잠시 후 다시 시도하세요', offline: '오프라인입니다. 연결되면 다시 조회합니다', norepo: '가격을 가져오지 못했습니다', error: '가격을 가져오지 못했습니다' };
  function hhmm(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function priceField(m, tk) {
    var q = S.quote, uq = U.quote || {}, busy = !!uq.busy;
    var btn = '<button class="btn small refresh" data-act="refreshquote" aria-label="현재가 다시 조회"' + (busy ? ' disabled' : '') + '>' + (busy ? '조회 중…' : '↻') + '</button>';
    if (S.demo || uq.reason) {
      return '<div class="field"><label for="px">' + esc(tk) + ' 현재가 (달러)' + (!S.demo && q && q.source === 'manual' ? ' <span class="chip hold">직접 입력</span>' : '') + '</label><div class="pxline"><input id="px" class="num" inputmode="decimal" value="' + (m.price > 0 ? m.price : '') + '" data-act="price" placeholder="예: 62.40">' + (S.demo ? '' : btn) + '</div>'
        + (S.demo ? '' : '<span class="hint">' + esc(REASON[uq.reason] || REASON.error) + '</span>') + '</div>';
    }
    var line = q && q.price > 0 ? esc(tk) + ' <b class="num">' + money2(q.price) + '</b>' + (q.at ? '<small class="asof">' + hhmm(q.at) + ' 기준</small>' : '') + (q.source === 'manual' ? ' <span class="chip hold">직접 입력</span>' : '') : (busy ? esc(tk) + ' 현재가를 가져오는 중입니다' : esc(tk) + ' 현재가 없음');
    return '<div class="field"><label>현재가 (달러)</label><div class="pxline"><span class="pxtext">' + line + '</span>' + btn + '</div></div>';
  }
  function viewToday() {
    var m = model(), s = m.s, c = m.cur, nx = m.next, today = m.today, tk = s.ticker || 'TQQQ';
    var tasks = tasksFor(m), inWin = !m.before && today >= addDays(c.start, 12);
    var out = '';
    out += demoBanner();
    if (m.before) out += '<div class="banner"><p>시작일은 ' + short(s.startDate) + '입니다. 시작일부터 사이클 1이 진행됩니다.</p></div>';
    var nextTask = tasks.filter(function (x) { return !x.done && today >= (x.from || addDays(x.d, -3)); })[0];
    if (nextTask) out += '<div class="banner"><p><b>' + esc(nextTask.t) + '</b> ' + taskChip(nextTask, today) + '</p></div>';

    // current cycle
    var zoneChip = m.zone === 'buy' ? '<span class="chip buy">▼ 매수 구간</span>' : m.zone === 'sell' ? '<span class="chip sell">▲ 매도 구간</span>' : m.zone === 'hold' ? '<span class="chip hold">● 밴드 안 · 대기</span>' : '<span class="chip hold">현재가 입력 전</span>';
    var lo = c.V * 0.75, hi = c.V * 1.25, ev = isFinite(m.evalNow) ? m.evalNow : null;
    function pct(v) { return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)); }
    var used = c.buyCost, budget = c.budget, usedPct = budget > 0 ? Math.min(100, used / budget * 100) : 0;
    out += '<section class="card"><h2>사이클 ' + m.n + ' <span class="sub">' + short(c.start) + ' – ' + short(c.end) + ' · D+' + Math.max(0, Math.min(13, daysBetween(c.start, today))) + '/14</span></h2>';
    out += '<div class="grid3"><div class="stat"><span class="label">V값</span><span class="v big">' + money(c.V) + '</span></div>'
      + '<div class="stat"><span class="label">최소밴드 −' + s.bandLow + '%</span><span class="v">' + money(c.min) + '</span></div>'
      + '<div class="stat"><span class="label">최대밴드 +' + s.bandHigh + '%</span><span class="v">' + money(c.max) + '</span></div></div>';
    out += '<div><div class="gauge"><div class="track"><div class="inband" style="left:' + pct(c.min).toFixed(1) + '%;right:' + (100 - pct(c.max)).toFixed(1) + '%"></div><div class="sellzone" style="left:' + pct(c.max).toFixed(1) + '%"></div></div><div class="vtick" style="left:' + pct(c.V).toFixed(1) + '%"></div>' + (ev != null ? '<div class="mark" style="left:' + pct(ev).toFixed(1) + '%"></div>' : '') + '</div>'
      + '<div class="gauge-labels"><span>매수 ←</span><span>V</span><span>→ 매도</span></div></div>';
    out += '<div class="grid2">' + priceField(m, tk)
      + '<div class="stat"><span class="label">보유 ' + int(m.held) + '주 · 평가금</span><span class="v big">' + (ev != null ? money(ev) : '-') + '</span><span class="s">' + zoneChip + '</span></div></div>';
    out += '<div><div class="label" style="display:flex;justify-content:space-between"><span>Pool 사용한도 ' + s.poolLimit + '%</span><span class="num">' + money2(used) + ' / ' + money2(budget) + '</span></div><div class="bar" role="img" aria-label="Pool 사용한도 사용률 ' + usedPct.toFixed(0) + '%"><i style="width:' + usedPct.toFixed(1) + '%"></i></div></div>';
    out += '<div class="grid2"><div class="stat"><span class="label">현재 Pool</span><span class="v">' + money2(c.poolEnd) + '</span></div><div class="stat"><span class="label">이번 사이클 매수 / 매도</span><span class="v">' + int(c.buyQty) + ' / ' + int(c.sellQty) + '주</span></div></div></section>';

    // next cycle prep
    var nBudget = nx.budget, buys = buyLadder(nx.min, nx.sharesStart, nBudget, nx.poolStart, 30), sells = sellLadder(nx.max, nx.sharesStart, 12);
    out += '<section class="card' + (inWin ? ' focus' : '') + '"><h2>사이클 ' + (m.n + 1) + ' 준비 <span class="sub">' + (inWin ? '예약 주문을 걸 시간 · ' + short(addDays(c.start, 12)) + '–' + short(addDays(c.start, 14)) : '지금 Pool 기준 미리보기') + '</span></h2>';
    out += '<div class="grid3"><div class="stat"><span class="label">새 V값</span><span class="v big">' + money(nx.V) + '</span><span class="s">' + (nx.V >= c.V ? '+' : '') + money(nx.V - c.V) + '</span></div>'
      + '<div class="stat"><span class="label">최소밴드</span><span class="v">' + money(nx.min) + '</span></div><div class="stat"><span class="label">최대밴드</span><span class="v">' + money(nx.max) + '</span></div></div>';
    out += '<div class="grid2"><div class="stat"><span class="label">새 Pool</span><span class="v">' + money2(nx.poolStart) + '</span><span class="s">' + (c.c ? (c.c > 0 ? '적립 ' : '인출 ') + money2(Math.abs(c.c)) + ' 반영' : '추가 입출금 없음') + '</span></div><div class="stat"><span class="label">매수 사용한도</span><span class="v">' + money2(nBudget) + '</span><span class="s">Pool의 ' + s.poolLimit + '%</span></div></div>';
    out += '<details' + (inWin ? ' open' : '') + '><summary>예약주문 계산표 (보유 ' + int(nx.sharesStart) + '주 기준)</summary><div class="grid2"><div class="scroll"><table><thead><tr><th>매수</th><th class="num">가격</th><th class="num">누적</th></tr></thead><tbody>'
      + (buys.length ? buys.map(function (r) { return '<tr><td>' + r.k + '번째</td><td class="num">' + money2(r.price) + '</td><td class="num">' + money2(r.cum) + '</td></tr>'; }).join('') : '<tr><td colspan="3">한도 안에서 살 수 있는 주문이 없습니다</td></tr>')
      + '</tbody></table></div><div class="scroll"><table><thead><tr><th>매도</th><th class="num">가격</th><th class="num">누적</th></tr></thead><tbody>'
      + (sells.length ? sells.map(function (r) { return '<tr><td>' + r.k + '번째</td><td class="num">' + money2(r.price) + '</td><td class="num">' + money2(r.cum) + '</td></tr>'; }).join('') : '<tr><td colspan="3">보유 수량이 없습니다</td></tr>')
      + '</tbody></table></div></div><p class="hint" style="margin-top:8px">가격 단계마다 1주씩 거는 방식으로 계산한 참고값입니다. 실제 주문 전에 라오어님의 공식 계산 방식과 꼭 대조하세요. 매수는 사용한도 안에서만 표시합니다.</p></details></section>';

    // checklist
    out += '<section class="card"><h2>사이클 ' + m.n + ' 체크리스트 <span class="sub">' + tasks.filter(function (x) { return x.done; }).length + '/' + tasks.length + ' 완료</span></h2><div>';
    tasks.forEach(function (x) {
      out += '<label class="task' + (x.done ? ' done' : '') + '"><input type="checkbox" data-act="check" data-v="' + m.n + ':' + x.key + '"' + (x.done ? ' checked' : '') + '><span class="t">' + esc(x.t) + '<small>' + short(x.from || x.d) + (x.from ? ' – ' + short(x.d) : '') + '까지</small></span>' + taskChip(x, today) + '</label>';
    });
    out += '</div><button class="btn" data-act="ics">캘린더에 추가</button><p class="hint">저장할 캘린더로 \'네이버\'를 고르세요. 설정에서 시작일을 바꾸면 기존 일정을 지우고 다시 추가하세요.</p><p class="msg' + (U.msg.icsOk ? ' ok' : '') + '" id="ics-msg" role="status">' + esc(U.msg.ics || '') + '</p></section>';
    return out;
  }

  function viewLog() {
    var m = model(), s = m.s, out = demoBanner();
    out += '<section class="card"><h2>매매 기록 추가</h2><div class="seg" role="group" aria-label="매수 또는 매도"><button class="buy" data-act="side" data-v="buy" aria-pressed="' + (U.side === 'buy') + '">매수</button><button class="sell" data-act="side" data-v="sell" aria-pressed="' + (U.side === 'sell') + '">매도</button></div>'
      + '<div class="grid3"><div class="field"><label for="t-date">체결일</label><input id="t-date" type="date" value="' + m.today + '"></div><div class="field"><label for="t-qty">수량(주)</label><input id="t-qty" class="num" inputmode="numeric" placeholder="1"></div><div class="field"><label for="t-px">체결가($)</label><input id="t-px" class="num" inputmode="decimal" placeholder="0.00"></div></div>'
      + '<div class="field"><label for="t-memo">메모 (선택)</label><input id="t-memo" maxlength="80" placeholder="예: 예약 매수 3번째"></div>'
      + '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between"><span class="num" id="t-total" style="color:var(--ink2)">합계 $0.00</span><button class="btn primary" data-act="addtrade">기록하기</button></div><p class="msg' + (U.msg.tradeOk ? ' ok' : '') + '" id="t-msg" role="status">' + esc(U.msg.trade || '') + '</p></section>';
    // cycle table
    var rows = m.rows.slice(0, m.n);
    out += '<section class="card"><h2>사이클별 요약 <span class="sub">표</span></h2><div class="scroll"><table><thead><tr><th>사이클</th><th class="num">V값</th><th class="num">매수</th><th class="num">매도</th><th class="num">Pool 끝</th><th class="num">평가금</th></tr></thead><tbody>';
    rows.slice().reverse().forEach(function (r) {
      var p = m.priceOf(r.n), e = p > 0 ? r.sharesEnd * p : NaN, cm = S.closeMeta && S.closeMeta[r.n];
      out += '<tr><td>' + r.n + ' <span class="label">' + short(r.start).replace(/\(.\)/, '') + '</span></td><td class="num">' + money(r.V) + '</td><td class="num">' + int(r.buyQty) + '</td><td class="num">' + int(r.sellQty) + '</td><td class="num">' + money(r.poolEnd) + '</td><td class="num">' + (isFinite(e) ? money(e) : '-') + (isFinite(e) && r.n < m.n && !S.demo && (!cm || cm.source === 'manual') ? ' <span class="chip hold">직접</span>' : '') + '</td></tr>';
    });
    out += '</tbody></table></div><p class="hint">끝난 사이클의 평가금은 종가로 계산하며, 종가는 앱을 열 때 자동으로 채웁니다. 현재 사이클은 현재가 기준입니다.</p>';
    if (!S.demo) {
      var ended = rows.filter(function (r) { return cycleEnded(r, m.today); }).reverse(), cq = U.close || {};
      if (ended.length) {
        var sel = ended.some(function (r) { return r.n === U.closeSel; }) ? U.closeSel : ended[0].n;
        var opts = '<div class="field"><label for="cp-n">종가 사이클</label><select id="cp-n" data-act="closesel">' + ended.map(function (r) { return '<option value="' + r.n + '"' + (r.n === sel ? ' selected' : '') + '>사이클 ' + r.n + '</option>'; }).join('') + '</select></div>';
        out += '<div class="grid2">' + opts + '<div class="field"><label>&nbsp;</label><button class="btn" data-act="refetchclose"' + (cq.busy ? ' disabled' : '') + '>' + (cq.busy ? '가져오는 중…' : '종가 다시 가져오기') + '</button></div></div>';
        if (cq.reason) out += '<p class="hint">' + esc(REASON[cq.reason] || REASON.error) + ' 아래에 직접 입력할 수 있습니다.</p><div class="field"><label for="cp-px">그 사이클 마지막 종가($) <span class="chip hold">직접 입력</span></label><input id="cp-px" class="num" inputmode="decimal" placeholder="0.00" value="' + esc(U.closeTyped || '') + '"></div><button class="btn" data-act="closeprice">종가 저장</button>';
      }
      out += '<p class="msg' + (U.msg.cpOk ? ' ok' : '') + '" id="cp-msg" role="status">' + esc(U.msg.cp || '') + '</p>';
    }
    out += '</section>';
    out += viewSend(m, rows);
    // trade list
    var byC = {}; S.trades.forEach(function (t) { var n = cycleIndexFor(s.startDate, t.date); (byC[n] = byC[n] || []).push(t); });
    var keys = Object.keys(byC).map(Number).sort(function (a, b) { return b - a; });
    out += '<section class="card"><h2>체결 내역 <span class="sub">' + S.trades.length + '건</span></h2>';
    if (!keys.length) out += '<p class="hint">아직 기록이 없습니다. 위에서 첫 체결을 추가해 보세요.</p>';
    keys.forEach(function (n) {
      var list = byC[n].slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      out += '<div class="group-title"><span>사이클 ' + n + '</span><span class="num">' + short(cycleStartDate(s.startDate, n)).replace(/\(.\)/, '') + '~</span></div>';
      list.forEach(function (t) {
        var armed = U.armed === 'del:' + t.id;
        out += '<div class="trade"><span class="side ' + t.side + '">' + (t.side === 'buy' ? '매수' : '매도') + '</span><span class="main num">' + int(t.qty) + '주 × ' + money2(t.price) + ' = ' + money2(t.qty * t.price) + '</span><button class="btn small' + (armed ? ' warn' : '') + '" data-act="deltrade" data-v="' + esc(t.id) + '">' + (armed ? '한 번 더 눌러 삭제' : '삭제') + '</button><span class="meta">' + short(t.date) + (t.memo ? ' · ' + esc(t.memo) : '') + '</span></div>';
      });
    });
    return out + '</section>';
  }

  function viewSend(m, rows) {
    var ended = rows.filter(function (r) { return cycleEnded(r, m.today); }).reverse(), us = U.send || {}, sc = secrets();
    var sel = ended.some(function (r) { return r.n === U.noteSel; }) ? U.noteSel : (ended.length ? (ended.filter(function (r) { return S.prices[r.n] > 0; })[0] || ended[0]).n : 0);
    var why = S.demo ? '데모 화면에서는 보낼 수 없습니다. 내 기록을 시작한 뒤 이용하세요.' : !sc.ghToken ? '설정에서 GitHub 토큰을 넣으세요' : !(sel && S.prices[sel] > 0) ? '사이클이 끝나고 종가가 채워지면 보낼 수 있습니다' : '';
    var opts = ended.length ? '<div class="field"><label for="nt-n">보낼 사이클</label><select id="nt-n" data-act="notesel">' + ended.map(function (r) { return '<option value="' + r.n + '"' + (r.n === sel ? ' selected' : '') + '>사이클 ' + r.n + '</option>'; }).join('') + '</select></div>' : '';
    var ex = sel && S.exported && S.exported[sel], exd = ex && ex.at ? new Date(ex.at) : null;
    var mark = exd && isFinite(exd.getTime()) ? '<span class="chip">보냄 · ' + (exd.getMonth() + 1) + '/' + exd.getDate() + '</span>' : '';
    var disabled = !!why || us.busy;
    return '<section class="card"><h2>Obsidian으로 보내기</h2>' + opts
      + '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between"><button class="btn primary" data-act="sendnote"' + (disabled ? ' disabled' : '') + '>' + (us.busy ? '보내는 중…' : 'Obsidian으로 보내기') + '</button>' + mark + '</div>'
      + (why ? '<p class="hint">' + esc(why) + '</p>' : '')
      + '<p class="msg' + (U.msg.sendOk ? ' ok' : '') + '" id="nt-msg" role="status">' + esc(U.msg.send || '') + '</p></section>';
  }

  function viewChart() {
    var m = model(), rows = m.rows.slice(0, m.n), off = Math.max(0, rows.length - 26); rows = rows.slice(off);
    var cats = rows.map(function (r) { return String(r.n); });
    var evals = rows.map(function (r) { var p = m.priceOf(r.n); return p > 0 ? r.sharesEnd * p : null; });
    var out = demoBanner();
    var c1 = drawChart('ch-v', cats, { label: 'V값, 밴드, 평가금 추이', band: { lo: rows.map(function (r) { return r.min; }), hi: rows.map(function (r) { return r.max; }) },
      lines: [{ vals: rows.map(function (r) { return r.V; }), cls: 's-v' }, { vals: evals, cls: 's-eval', dots: true, dot: 's-dot-eval' }],
      readout: function (i) { var r = rows[i], e = evals[i]; document.getElementById('ro-v').innerHTML = '<span>사이클 <b>' + r.n + '</b></span><span>V <b>' + money(r.V) + '</b></span><span>밴드 <b>' + money(r.min) + '–' + money(r.max) + '</b></span><span>평가금 <b>' + (e != null ? money(e) : '-') + '</b></span>'; } });
    var c2 = drawChart('ch-p', cats, { label: 'Pool 잔액 추이', zero: true, lines: [{ vals: rows.map(function (r) { return r.poolEnd; }), cls: 's-pool', dots: true, dot: 's-dot-pool' }],
      readout: function (i) { var r = rows[i]; document.getElementById('ro-p').innerHTML = '<span>사이클 <b>' + r.n + '</b></span><span>Pool <b>' + money2(r.poolEnd) + '</b></span><span>사용 <b>' + money2(r.buyCost) + '</b></span><span>회수 <b>' + money2(r.sellIn) + '</b></span>'; } });
    out += '<section class="card chartbox"><h2>V값과 평가금 <span class="sub">가로: 사이클</span></h2><div class="readout" id="ro-v" aria-live="polite"></div>' + c1
      + '<div class="legend"><span><i style="background:var(--ink)"></i>V값</span><span><i class="band"></i>최소~최대 밴드</span><span><i style="background:var(--accent)"></i>평가금(종가, 현재 사이클은 현재가)</span></div></section>';
    out += '<section class="card chartbox"><h2>Pool 잔액 <span class="sub">사이클 종료 시점</span></h2><div class="readout" id="ro-p" aria-live="polite"></div>' + c2
      + '<div class="legend"><span><i style="background:var(--pool)"></i>Pool</span></div></section>';
    var last = rows[rows.length - 1], p = m.priceOf(last.n), e = p > 0 ? last.sharesEnd * p : NaN;
    out += '<section class="card"><h2>현재 요약</h2><div class="grid2"><div class="stat"><span class="label">평가금 + Pool</span><span class="v big">' + (isFinite(e) ? money(e + last.poolEnd) : '-') + '</span></div><div class="stat"><span class="label">V값 대비 평가금</span><span class="v big">' + (isFinite(e) ? ((e / last.V - 1) * 100).toFixed(1) + '%' : '-') + '</span></div></div><p class="hint">차트를 터치하거나 마우스를 올리면 사이클별 값이 위에 표시됩니다.</p></section>';
    return out;
  }

  function fld(id, label, val, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" class="num" inputmode="decimal" value="' + esc(val) + '"' + (extra || '') + '></div>'; }
  function viewSet() {
    var s = S.settings || {}, d = S.demo, def = d ? { mode: 'accumulate', G: 10, bandLow: 15, bandHigh: 15, poolLimit: 75, amount: '', startDate: mondayOf(todayStr()), v1: '', pool0: '', shares0: '', ticker: 'TQQQ' } : s;
    var out = demoBanner();
    out += '<section class="card"><h2>' + (d ? '내 설정으로 시작' : 'VR 설정') + '</h2>';
    out += '<div class="field"><label>투자 방식</label><div class="seg" role="group" aria-label="투자 방식">' + [['accumulate', '적립식'], ['lump', '거치식'], ['withdraw', '인출식']].map(function (x) { return '<button data-act="mode" data-v="' + x[0] + '" aria-pressed="' + (def.mode === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
    out += '<div class="grid2">' + fld('f-G', 'G값 (기울기)', def.G) + fld('f-pl', 'Pool 사용한도 (%)', def.poolLimit) + fld('f-bl', '최소밴드 폭 (%)', def.bandLow) + fld('f-bh', '최대밴드 폭 (%)', def.bandHigh) + '</div>';
    out += '<div class="grid2">' + fld('f-amt', '사이클당 적립/인출금($)', def.amount, ' placeholder="없으면 0"') + '<div class="field"><label for="f-tk">종목</label><input id="f-tk" maxlength="10" value="' + esc(def.ticker || 'TQQQ') + '"></div></div>';
    out += '<div class="field"><label for="f-sd">사이클 1 시작일 (월요일 권장)</label><input id="f-sd" type="date" value="' + esc(def.startDate) + '"></div>';
    out += '<div class="grid3">' + fld('f-v1', '처음 V값($)', def.v1, ' placeholder="평가금"') + fld('f-p0', '처음 Pool($)', def.pool0) + fld('f-s0', '보유 수량(주)', def.shares0) + '</div>';
    out += '<p class="hint">' + (d ? '' : '지난 사이클의 값까지 모두 다시 계산됩니다. 이미 진행 중이면 처음 값은 바꾸지 마세요. ') + '방식을 바꾸면 G값과 사용한도가 기본값(적립·거치 G=10, 인출 G=20)으로 채워집니다. 직접 고쳐도 됩니다.</p>';
    out += '<button class="btn primary" data-act="saveset">' + (d ? '이 설정으로 시작하기' : '설정 저장') + '</button><p class="msg' + (U.msg.setOk ? ' ok' : '') + '" id="set-msg" role="status">' + esc(U.msg.set || '') + '</p></section>';
    if (!d) {
      out += '<section class="card"><h2>백업과 복원</h2><p class="hint">기록은 이 아이폰 안에만 저장됩니다. 앱을 지우거나 기기를 바꾸면 사라지니 가끔 파일로 내보내 두세요.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="export">파일로 저장</button><button class="btn" data-act="copy">복사</button></div><p class="msg' + (U.msg.bkOk ? ' ok' : '') + '" id="bk-msg" role="status">' + esc(U.msg.bk || '') + '</p>'
        + '<div class="field"><label for="imp">복원할 내용 붙여넣기</label><textarea id="imp" placeholder="내보낸 JSON을 붙여넣으세요"></textarea></div><button class="btn' + (U.armed === 'import' ? ' warn' : '') + '" data-act="import">' + (U.armed === 'import' ? '현재 기록을 덮어씁니다. 한 번 더 눌러 확인' : '불러오기') + '</button></section>';
      var sc = secrets();
      function pw(id, label, v, k) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="password" autocomplete="off" placeholder="' + (v ? esc('저장됨 ••••' + v.slice(-4)) : '') + '">' + clr(k, v) + '</div>'; }
      function clr(k, v) { if (!v) return ''; var a = U.armed === 'clr:' + k; return '<button class="btn small' + (a ? ' warn' : '') + '" data-act="clearsecret" data-v="' + k + '">' + (a ? '한 번 더 눌러 지우기' : '지우기') + '</button>'; }
      function tx(id, label, v) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" autocomplete="off" autocapitalize="off" value="' + esc(v) + '"></div>'; }
      out += '<section class="card"><h2>연결</h2><p class="hint">시세 조회와 Obsidian 기록에 쓰는 키입니다. 이 기기에만 저장되며 백업 파일에는 들어가지 않습니다. 비워 두면 저장된 값을 그대로 씁니다.</p>'
        + pw('c-td', 'Twelve Data API 키', sc.tdKey, 'tdKey') + pw('c-gh', 'GitHub 토큰', sc.ghToken, 'ghToken') + tx('c-repo', '저장소', sc.repo) + tx('c-br', '브랜치', sc.branch) + tx('c-fo', '폴더', sc.folder)
        + '<button class="btn primary" data-act="savesecrets">연결 저장</button><p class="msg' + (U.msg.connOk ? ' ok' : '') + '" id="conn-msg" role="status">' + esc(U.msg.conn || '') + '</p>'
        + '<p class="hint">Twelve Data: twelvedata.com 가입 → 대시보드의 API key<br>GitHub: Settings → Developer settings → Fine-grained tokens → 저장소 obsidian-vault 하나, Contents: Read and write</p></section>';
      out += '<section class="card"><h2>처음부터 다시</h2><p class="hint">모든 설정과 기록을 지우고 예시 화면으로 돌아갑니다.</p><button class="btn warn" data-act="reset">' + (U.armed === 'reset' ? '정말 지웁니다. 한 번 더 눌러 확인' : '모든 기록 지우기') + '</button></section>';
    }
    return out;
  }

  function render() {
    if (!S) return;
    chartCtx = {};
    var v = U.tab === 'today' ? viewToday : U.tab === 'log' ? viewLog : U.tab === 'chart' ? viewChart : viewSet;
    $app.innerHTML = '<header class="top"><h1>VR Tracker</h1><span class="sync" id="sync"></span></header>' + v();
    $tabs.innerHTML = TABS.map(function (t) { return '<button data-act="tab" data-v="' + t[0] + '"' + (U.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>'; }).join('');
    paintSync();
    if (U.tab === 'chart') { bindChart('ch-v'); bindChart('ch-p'); ['ch-v', 'ch-p'].forEach(function (id) { if (chartCtx[id]) chartCtx[id].cb(chartCtx[id].N - 1); }); }
    if (U.tab === 'log') bindLogForm();
  }
  function bindLogForm() {
    var q = document.getElementById('t-qty'), p = document.getElementById('t-px'), t = document.getElementById('t-total');
    function upd() { var a = num(q.value), b = num(p.value); t.textContent = '합계 ' + (isFinite(a) && isFinite(b) ? money2(a * b) : '$0.00'); }
    q.addEventListener('input', upd); p.addEventListener('input', upd);
  }

  /* ---------- actions ---------- */
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function setMsg(k, text, ok) { U.msg[k] = text; U.msg[k + 'Ok'] = !!ok; }
  var sendReq = null, SEND_REASON = { auth: '토큰 권한을 확인하세요.', norepo: '저장소 이름을 확인하세요.', offline: '오프라인입니다.', nokey: '설정에서 GitHub 토큰을 넣으세요.', error: '보내지 못했습니다.' };
  var actions = {
    tab: function (v) { U.tab = v; U.armed = ''; render(); window.scrollTo(0, 0); },
    side: function (v) {
      U.side = v;
      document.querySelectorAll('[data-act="side"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
    },
    price: function (v, el) {
      var p = num(el.value), m = model();
      if (S.demo) {
        if (el.value.trim() === '') { delete S.prices[m.n]; } else if (isFinite(p) && p > 0) { S.prices[m.n] = p; } else return;
      } else if (el.value.trim() === '') { S.quote = null; } else if (isFinite(p) && p > 0) { S.quote = { price: p, at: Date.now(), source: 'manual' }; } else return;
      save(); render();
    },
    check: function (v, el) { if (el.checked) S.checks[v] = true; else delete S.checks[v]; save(); render(); },
    addtrade: function () {
      var d = val('t-date'), q = num(val('t-qty')), p = num(val('t-px'));
      if (!d) return fail('trade', '체결일을 입력하세요.');
      if (!(q > 0) || Math.floor(q) !== q) return fail('trade', '수량은 1 이상의 정수로 입력하세요.');
      if (!(p > 0)) return fail('trade', '체결가를 0보다 크게 입력하세요.');
      if (S.demo) return fail('trade', '예시 화면에서는 기록할 수 없습니다. 설정에서 먼저 시작하세요.');
      if (d < S.settings.startDate) return fail('trade', '체결일이 사이클 1 시작일(' + short(S.settings.startDate) + ')보다 앞섭니다.');
      var t = { id: uid(), date: d, side: U.side, qty: q, price: p, memo: val('t-memo').trim() };
      if (t.side === 'sell') { var held = model().held; if (q > held + 1e-9 && d >= model().cur.start) return fail('trade', '보유 수량(' + int(held) + '주)보다 많이 팔 수 없습니다.'); }
      S.trades.push(t); setMsg('trade', '기록했습니다.', true); save(); render();
    },
    deltrade: function (v) {
      if (S.demo) return;
      if (U.armed !== 'del:' + v) { U.armed = 'del:' + v; render(); return; }
      S.trades = S.trades.filter(function (t) { return t.id !== v; }); U.armed = ''; save(); render();
    },
    closeprice: function () {
      var n = parseInt(val('cp-n'), 10), p = num(val('cp-px')), row = buildLedger(S, n)[n - 1];
      if (S.demo) { U.msg.cp = '예시 화면에서는 저장되지 않습니다.'; U.msg.cpOk = false; return render(); }
      if (!(p > 0)) { U.closeSel = n; U.msg.cp = '종가를 0보다 크게 입력하세요.'; U.msg.cpOk = false; return render(); }
      U.closeSel = n; S.prices[n] = p; U.closeTyped = ''; S.closeMeta[n] = { date: row.end, source: 'manual' }; U.msg.cp = '사이클 ' + n + ' 종가를 저장했습니다.'; U.msg.cpOk = true; save(); render();
    },
    notesel: function (v, el) { U.noteSel = parseInt(el.value, 10); U.msg.send = ''; render(); },
    sendnote: function () {
      if (S.demo || (U.send && U.send.busy)) return;
      var m = model(), s = m.s, sc = secrets(), n = parseInt(val('nt-n'), 10), row = null;
      m.rows.forEach(function (r) { if (r.n === n) row = r; });
      if (!(row && cycleEnded(row, m.today) && S.prices[n] > 0 && sc.ghToken)) return;
      U.noteSel = n; U.msg.send = ''; U.msg.sendOk = false;
      var trades = S.trades.filter(function (t) { return cycleIndexFor(s.startDate, t.date) === n; }).map(function (t) {
        return { id: t.id, date: t.date, side: t.side, qty: Number(t.qty), price: Number(t.price), memo: t.memo };
      });
      var cm = S.closeMeta && S.closeMeta[n], note;
      try { note = cycleNote(row, trades, { price: Number(S.prices[n]), date: cm && cm.date ? cm.date : row.end }, s.ticker || 'TQQQ'); }
      catch (e) { U.msg.send = '보내지 못했습니다.'; return render(); }
      var mine = (sendReq = {});
      U.send = { busy: true }; softRender();
      function done(msg, ok) { if (sendReq !== mine) return; U.send = {}; U.msg.send = msg; U.msg.sendOk = ok; render(); }
      function fail() { done('보내지 못했습니다.', false); }
      function ok(r) {
        try {
          if (r && r.ok) { S.exported = S.exported || {}; S.exported[n] = { at: new Date().toISOString() }; save(); done('사이클 ' + n + ' 노트를 보냈습니다.', true); }
          else done(SEND_REASON[r && r.reason] || SEND_REASON.error, false);
        } catch (e) { fail(); }
      }
      try {
        VRNet.putVaultFile({ token: sc.ghToken, repo: sc.repo, branch: sc.branch }, sc.folder + '/' + noteFileName(n), note, 'VR 사이클 ' + n + ' 기록', window.fetch.bind(window)).then(ok).catch(fail);
      } catch (e) { fail(); }
    },
    closesel: function (v, el) { U.closeSel = parseInt(el.value, 10); },
    refreshquote: function () { refreshQuote(); },
    refetchclose: function () { var n = parseInt(val('cp-n'), 10); U.closeSel = n; U.msg.cp = ''; fillCloses(n); },
    mode: function (v) {
      var def = modeDefaults(v);
      document.querySelectorAll('[data-act="mode"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
      document.getElementById('f-G').value = def.G; document.getElementById('f-pl').value = def.poolLimit;
    },
    saveset: function () {
      var f = collectForm(false); if (typeof f === 'string') return fail('set', f);
      if (S.demo) { S = { demo: false, settings: f, trades: [], prices: {}, checks: {}, quote: null, closeMeta: {}, exported: {}, savedAt: 0 }; U.tab = 'today'; U.msg = {}; U.quote = {}; U.close = {}; save(); render(); window.scrollTo(0, 0); refreshAll(); return; }
      var tkChanged = f.ticker !== S.settings.ticker;
      S.settings = f; if (tkChanged) S.quote = null;
      setMsg('set', '저장했습니다. 모든 사이클을 다시 계산했습니다.', true); save(); render(); if (tkChanged) refreshAll();
    },
    ics: function () {
      if (S.demo) { setMsg('ics', '예시 화면에서는 캘린더를 추가할 수 없습니다. 설정에서 먼저 시작하세요.'); return render(); }
      var text;
      try { text = buildIcs(S.settings, location.origin + location.pathname); } catch (e) { setMsg('ics', '캘린더 파일을 만들지 못했습니다.'); return render(); }
      saveFile('vr-tracker-cycle.ics', text, 'text/calendar').then(function () { setMsg('ics', '캘린더 파일을 내보냈습니다.', true); render(); }).catch(function (e) { setMsg('ics', e && e.name === 'AbortError' ? '추가를 취소했습니다.' : '캘린더 파일을 만들지 못했습니다.'); render(); });
    },
    export: function () {
      var b = JSON.stringify(bodyOf(S), null, 1), name = 'vr-tracker-' + todayStr() + '.json';
      saveFile(name, b).then(function () { setMsg('bk', '파일을 내보냈습니다.', true); render(); }).catch(function (e) { setMsg('bk', e && e.name === 'AbortError' ? '저장을 취소했습니다.' : '파일 저장에 실패했습니다. 복사를 사용하세요.'); render(); });
    },
    copy: function () {
      var b = JSON.stringify(bodyOf(S));
      function okk() { setMsg('bk', '복사했습니다. 메모 앱 등에 붙여 두세요.', true); render(); }
      function viaTa() { var ta = document.getElementById('imp'); ta.value = b; ta.focus(); ta.select(); setMsg('bk', '아래 칸에 내용을 채웠습니다. 전체 선택 후 복사하세요.'); var msg = document.getElementById('bk-msg'); if (msg) msg.textContent = U.msg.bk; }
      try { navigator.clipboard.writeText(b).then(okk, viaTa); } catch (e) { viaTa(); }
    },
    import: function () {
      var raw = val('imp').trim(), b; if (!raw) { setMsg('bk', '붙여넣은 내용이 없습니다.'); return render(); }
      try { b = JSON.parse(raw); } catch (e) { setMsg('bk', '형식이 올바르지 않습니다. 내보낸 내용을 그대로 붙여넣으세요.'); return render(); }
      if (!valid(b)) { setMsg('bk', '이 앱에서 내보낸 기록이 아닙니다.'); return render(); }
      if (U.armed !== 'import') { U.armed = 'import'; var keep = val('imp'); render(); document.getElementById('imp').value = keep; return; }
      S = fromBody(b); U.armed = ''; setMsg('bk', '불러왔습니다.', true); save(); render();
    },
    savesecrets: function () {
      var cur = secrets(), td = val('c-td').trim(), gh = val('c-gh').trim();
      var o = { tdKey: td || cur.tdKey, ghToken: gh || cur.ghToken, repo: val('c-repo').trim() || 'Leejieon/obsidian-vault', branch: val('c-br').trim() || 'main', folder: val('c-fo').trim().replace(/^\/+|\/+$/g, '') || 'wiki/투자/VR/사이클 기록' };
      if (saveSecrets(o)) setMsg('conn', '연결 정보를 저장했습니다.', true); else setMsg('conn', '저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.');
      render(); refreshAll();
    },
    clearsecret: function (v) {
      if (v !== 'tdKey' && v !== 'ghToken') return;
      if (U.armed !== 'clr:' + v) { U.armed = 'clr:' + v; return render(); }
      U.armed = '';
      var o = secrets(); o[v] = '';
      if (saveSecrets(o)) setMsg('conn', '삭제했습니다.', true); else setMsg('conn', '저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.');
      render();
    },
    reset: function () {
      if (U.armed !== 'reset') { U.armed = 'reset'; return render(); }
      try { localStorage.removeItem(LS_KEY); localStorage.removeItem(SEC_KEY); } catch (e) {}
      S = makeDemo(); U.armed = ''; U.tab = 'today'; store.status = 'local'; render();
    }
  };
  function fail(k, text) { setMsg(k, text, false); var el = document.getElementById(k === 'trade' ? 't-msg' : 'set-msg'); if (el) { el.textContent = text; el.className = 'msg'; } }
  function collectForm(soft) {
    var modeBtn = document.querySelector('.seg [data-act="mode"][aria-pressed="true"]');
    var f = {
      mode: modeBtn ? modeBtn.getAttribute('data-v') : (S.settings && S.settings.mode) || 'accumulate',
      G: num(val('f-G')), poolLimit: num(val('f-pl')), bandLow: num(val('f-bl')), bandHigh: num(val('f-bh')),
      amount: val('f-amt').trim() === '' ? 0 : num(val('f-amt')), ticker: (val('f-tk') || 'TQQQ').trim().toUpperCase(),
      startDate: val('f-sd'), v1: num(val('f-v1')), pool0: val('f-p0').trim() === '' ? 0 : num(val('f-p0')), shares0: num(val('f-s0'))
    };
    if (soft) return f;
    if (!f.startDate) return '시작일을 입력하세요.';
    if (!(f.G > 0)) return 'G값은 0보다 커야 합니다.';
    if (!(f.poolLimit > 0 && f.poolLimit <= 100)) return 'Pool 사용한도는 1~100 사이로 입력하세요.';
    if (!(f.bandLow > 0 && f.bandLow < 100) || !(f.bandHigh > 0 && f.bandHigh < 100)) return '밴드 폭은 1~99 사이로 입력하세요.';
    if (!(f.v1 > 0)) return '처음 V값(처음 평가금)을 입력하세요.';
    if (!(f.pool0 >= 0)) return '처음 Pool은 0 이상이어야 합니다.';
    if (!(f.shares0 >= 0) || Math.floor(f.shares0) !== f.shares0) return '보유 수량은 0 이상의 정수로 입력하세요.';
    if (!(f.amount >= 0)) return '적립/인출금은 0 이상이어야 합니다.';
    return f;
  }

  /* ---------- market data (network; never in demo) ---------- */
  var lastQuoteAt = 0;
  function softRender() {
    if (!S) return;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingRender = true; return; }
    render();
  }
  var pendingRender = false;
  function fetchFn() { return window.fetch.bind(window); }
  var quoteReq = null, closeReq = null;   // in-flight requests; a newer one (other ticker) supersedes the older
  function refreshQuote() {
    if (!S || S.demo || !window.VRNet) return Promise.resolve();
    var tk = S.settings.ticker || 'TQQQ';
    if (quoteReq && quoteReq.tk === tk) return quoteReq.p;
    var mine = { tk: tk };
    quoteReq = mine; U.quote = { busy: true }; lastQuoteAt = Date.now(); softRender();
    function done(fn) { if (quoteReq !== mine) return; quoteReq = null; if (!S || S.demo || (S.settings.ticker || 'TQQQ') !== tk) { U.quote = {}; softRender(); return; } try { fn(); } catch (e) { U.quote = { reason: 'error' }; } softRender(); }
    mine.p = window.VRNet.fetchQuote(secrets().tdKey, tk, fetchFn()).then(function (r) {
      done(function () { if (r.ok) { S.quote = { price: r.price, at: r.at || null, source: 'api' }; U.quote = {}; save(); } else U.quote = { reason: r.reason }; });
    }).catch(function () { done(function () { U.quote = { reason: 'error' }; }); });
    return mine.p;
  }
  // force: a cycle number to refetch even if it already has an api close.
  function fillCloses(force) {
    if (!S || S.demo || !window.VRNet) return Promise.resolve();
    var s0 = S.settings, today = todayStr(), tk = s0.ticker || 'TQQQ', key = tk + ':' + force;
    if (closeReq && closeReq.key === key) return closeReq.p;
    if (today < s0.startDate) return Promise.resolve();
    var rows = buildLedger(S, cycleIndexFor(s0.startDate, today));
    var targets = rows.filter(function (r) {
      if (!cycleEnded(r, today)) return false;
      var cm = S.closeMeta[r.n];
      return r.n === force || !(S.prices[r.n] > 0) || !cm || cm.source === 'manual';   // no closeMeta = saved by the old app, often a typed mid-cycle price
    });
    if (!targets.length) { closeReq = null; U.close = {}; softRender(); return Promise.resolve(); }
    var start = targets.reduce(function (a, r) { return r.start < a ? r.start : a; }, targets[0].start);
    var mine = { key: key };
    closeReq = mine; U.close = { busy: true }; softRender();
    function done(fn) { if (closeReq !== mine) return; closeReq = null; if (!S || S.demo || (S.settings.ticker || 'TQQQ') !== tk) { U.close = {}; softRender(); return; } try { fn(); } catch (e) { U.close = { reason: 'error' }; } softRender(); }
    mine.p = window.VRNet.fetchDailyBars(secrets().tdKey, tk, start, today, fetchFn()).then(function (r) {
      done(function () {
        if (!r.ok) { U.close = { reason: r.reason }; return; }
        var got = window.pickCycleCloses(targets, r.bars, today), miss = false;
        targets.forEach(function (t) {
          var g = got[t.n];
          if (g) { S.prices[t.n] = g.price; S.closeMeta[t.n] = { date: g.date, source: 'api' }; }
          else if (!(S.prices[t.n] > 0)) miss = true;
        });
        U.close = miss ? { reason: 'error' } : {};
        save();
      });
    }).catch(function () { done(function () { U.close = { reason: 'error' }; }); });
    return mine.p;
  }
  function refreshAll() { return refreshQuote().then(function () { return fillCloses(); }); }
  document.addEventListener('input', function (ev) { if (ev.target && ev.target.id === 'cp-px') U.closeTyped = ev.target.value; });
  document.addEventListener('focusout', function () { if (pendingRender) setTimeout(function () { var a = document.activeElement; if (pendingRender && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { pendingRender = false; render(); } }, 0); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S && !S.demo && Date.now() - lastQuoteAt >= 30000) refreshAll();
  });
  window.addEventListener('online', function () { if (S && !S.demo) refreshAll(); });

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var a = el.getAttribute('data-act');
    if (a === 'price' || a === 'check' || a === 'closesel' || a === 'notesel') return;       // handled on change
    if (!(a === 'deltrade' || a === 'import' || a === 'reset' || a === 'clearsecret') && U.armed) U.armed = '';
    if (actions[a]) actions[a](el.getAttribute('data-v'), el);
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var a = el.getAttribute('data-act');
    if (a === 'price' || a === 'check' || a === 'closesel' || a === 'notesel') actions[a](el.getAttribute('data-v'), el);
  });

  /* ---------- boot ---------- */
  var local = lsRead();
  S = valid(local) ? fromBody(local) : makeDemo();
  store.status = 'local';
  render();
  initStorage();
  refreshAll();
})();
