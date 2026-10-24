// Network clients: Twelve Data quotes and GitHub Contents API. Never log keys/tokens.
(function () {
  var TD = 'https://api.twelvedata.com';

  function fail(reason) { return { ok: false, reason: reason }; }

  var api = {};
  api.timeoutMs = 10000;   // overridable (tests, or VRNet.timeoutMs in the page)

  // Runs work(signal) with a deadline; rejects with Error('timeout') and aborts the request when it passes.
  function withTimeout(work) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer;
    var guard = new Promise(function (_, reject) {
      timer = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) {} reject(new Error('timeout')); }, api.timeoutMs);
    });
    var run = Promise.resolve().then(function () { return work(ctl ? ctl.signal : undefined); });
    return Promise.race([run, guard]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function withSignal(init, signal) {
    if (!signal) return init;
    var o = {}; for (var k in init) o[k] = init[k];
    o.signal = signal; return o;
  }

  function b64utf8(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(text)));
  }

  function reasonFor(code) {
    if (code === 401 || code === 403) return 'auth';
    if (code === 429) return 'limit';
    return 'error';
  }

  // Returns parsed body or a failure object. Checks HTTP status and body status/code.
  function tdGet(url, fetchFn) {
    return withTimeout(function (signal) {
      return fetchFn(url, signal ? { signal: signal } : undefined).then(function (res) {
        if (res.status !== 200) return fail(reasonFor(res.status));
        return res.json().then(function (body) {
          if (body && body.status === 'error') return fail(reasonFor(Number(body.code)));
          return { ok: true, body: body || {} };
        });
      });
    }).catch(function () { return fail('offline'); });
  }

  function fetchQuote(apiKey, symbol, fetchFn) {
    if (!apiKey) return Promise.resolve(fail('nokey'));
    var url = TD + '/quote?symbol=' + encodeURIComponent(symbol) + '&apikey=' + encodeURIComponent(apiKey);
    return tdGet(url, fetchFn).then(function (r) {
      if (!r.ok) return r;
      var price = parseFloat(r.body.close);
      var ts = r.body.last_quote_at || r.body.timestamp;
      if (!isFinite(price) || !ts) return fail('error');
      return { ok: true, price: price, at: ts * 1000 };
    }).catch(function () { return fail('error'); });
  }

  function fetchDailyBars(apiKey, symbol, startDate, endDate, fetchFn) {
    if (!apiKey) return Promise.resolve(fail('nokey'));
    var url = TD + '/time_series?symbol=' + encodeURIComponent(symbol) + '&interval=1day' +
      '&start_date=' + encodeURIComponent(startDate) + '&end_date=' + encodeURIComponent(endDate) +
      '&apikey=' + encodeURIComponent(apiKey);
    return tdGet(url, fetchFn).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.values)) return fail('error');
      var bars = [];
      for (var i = 0; i < r.body.values.length; i++) {
        var v = r.body.values[i];
        var c = parseFloat(v.close);
        if (v.datetime && isFinite(c)) bars.push({ date: v.datetime, close: c });
      }
      return { ok: true, bars: bars };
    }).catch(function () { return fail('error'); });
  }

  function putVaultFile(cfg, path, text, message, fetchFn) {
    if (!cfg || !cfg.token || !cfg.repo) return Promise.resolve(fail('nokey'));
    var branch = cfg.branch || 'main';
    var encPath = path.split('/').map(encodeURIComponent).join('/');
    var url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + encPath;
    var headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' };

    function getSha() {
      return withTimeout(function (signal) {
        return fetchFn(url + '?ref=' + encodeURIComponent(branch), withSignal({ method: 'GET', headers: headers }, signal)).then(function (res) {
          if (res.status === 404) return { sha: null };
          if (res.status === 401 || res.status === 403) return fail('auth');
          if (res.status !== 200) return fail('error');
          return res.json().then(function (b) { return { sha: (b && b.sha) || null }; });
        });
      });
    }
    function put(sha) {
      var body = { message: message, content: b64utf8(text), branch: branch };
      if (sha) body.sha = sha;
      var h = { Authorization: headers.Authorization, Accept: headers.Accept, 'Content-Type': 'application/json' };
      return withTimeout(function (signal) { return fetchFn(url, withSignal({ method: 'PUT', headers: h, body: JSON.stringify(body) }, signal)); });
    }
    function attempt(retry) {
      return getSha().then(function (g) {
        if (g.ok === false) return g;
        return put(g.sha).then(function (res) {
          if (res.status === 200 || res.status === 201) return { ok: true };
          if ((res.status === 409 || res.status === 422) && retry) return attempt(false);
          if (res.status === 401 || res.status === 403) return fail('auth');
          if (res.status === 404) return fail('norepo');
          return fail('error');
        });
      });
    }
    return attempt(true).catch(function () { return fail('offline'); });
  }

  api.fetchQuote = fetchQuote; api.fetchDailyBars = fetchDailyBars; api.putVaultFile = putVaultFile; api.b64utf8 = b64utf8;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VRNet = api;
})();
