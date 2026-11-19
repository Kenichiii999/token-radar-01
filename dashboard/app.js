(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA || !DATA.rows) return;
  var M = DATA.model || {};
  var rowsAll = DATA.rows, liveAll = DATA.live || [];
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre-token', sort: 'rank', dir: 'asc', verdict: 'all', dep: 'plan', share: '0.07', selected: null };
  var $ = function (id) { return document.getElementById(id); };
  var app = $('board'), head = $('head'), tbody = $('rows'), dialog = $('detail');
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtNet(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var s = Math.abs(n) < 1000 ? (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2) : fmtUsd(n);
    return s;
  }
  function fmtPct100(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return Math.round(n * 100) + '%'; }
  function fmtPct(n, d) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(d === undefined ? 2 : d) + '%'; }
    function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function fmtMult(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return 'x' + n.toFixed(2); }
    function chainsOf(r) { return (r.chains && r.chains.length) ? r.chains.join(', ') : 'an unnamed chain'; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function isWatch(r) { if (r.is_watchlist !== undefined) return r.is_watchlist === true; return DATA.floor_usd !== undefined && r.tvl_usd >= DATA.floor_usd; }
  function isAboveFloor(r) { return DATA.floor_usd !== undefined && r.tvl_usd >= DATA.floor_usd; }

  function momOf(row) {
    if (row.model && row.model.momentum_multiplier !== undefined) return row.model.momentum_multiplier;
    var ch = (row.change_7d === null || row.change_7d === undefined) ? 0 : row.change_7d;
    var g = M.growth_weight === undefined ? 0.5 : M.growth_weight;
    return 1 + (clamp(ch, M.growth_floor === undefined ? -60 : M.growth_floor, M.growth_cap === undefined ? 120 : M.growth_cap) / 100) * g;
  }
  function curveVal(fwd, target) {
    var a = M.curve_a, b = M.curve_b;
    if (a === undefined || b === undefined) return null;
    var cands = [Math.exp(a) * Math.pow(fwd, b), a * Math.pow(fwd, b), Math.pow(10, a) * Math.pow(fwd, b)];
    if (target !== undefined && target !== null && isFinite(target)) {
      var best = cands[0]; cands.forEach(function (c) { if (Math.abs(c - target) < Math.abs(best - target)) best = c; });
      return best;
    }
    return a > 1 ? cands[2] : cands[0]; // comps-3 stores a base-10 log intercept (3.38)
  }
  function chainOf(row) {
    var mom = momOf(row);
    var fwd = (row.forward_tvl_usd !== undefined && row.forward_tvl_usd !== null) ? row.forward_tvl_usd : row.tvl_usd * mom;
    var prem = (row.category_premium !== undefined && row.category_premium !== null) ? row.category_premium : (row.model && row.model.premium !== undefined ? row.model.premium : 1);
    var size = (row.size_curve_usd !== undefined && row.size_curve_usd !== null) ? row.size_curve_usd : curveVal(fwd, (row.value_if_launches_usd !== undefined && row.value_if_launches_usd !== null) ? row.value_if_launches_usd / prem : null);
    if (size === null || !isFinite(size)) size = fwd * (DATA.global_multiple || 0.17);
    var val = (row.value_if_launches_usd !== undefined && row.value_if_launches_usd !== null) ? row.value_if_launches_usd : size * prem;
    var odds = (row.launch_odds !== undefined && row.launch_odds !== null) ? row.launch_odds : (row.model && row.model.launch_odds !== undefined ? row.model.launch_odds : 0);
    return { fwd: fwd, size: size, premium: prem, val: val, odds: odds, imp: Math.max(1, Math.round(val * odds)), mom: mom };
  }
  function impliedOf(row) { return chainOf(row).imp; }

  function depVal(row) { return state.dep === 'plan' ? (row.plan_size_usd || 1000) : parseInt(state.dep, 10); }
  function shareVal() { return parseFloat(state.share); }
  function nearestIdx(arr, v) {
    if (!arr || !arr.length) return -1;
    var bi = 0, bd = Infinity;
    for (var i = 0; i < arr.length; i++) { var d = Math.abs(arr[i] - v); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }
  function dropAt(row, dep, share) { return row.implied_value_usd * share * dep / Math.max(1, row.tvl_usd); }
  function netAt(row, dep, share) {
    var vt = row.verdict_table;
    if (vt && vt.nets) {
      var di = nearestIdx(vt.deposits, dep), si = nearestIdx(vt.shares, share);
      if (di >= 0 && si >= 0 && vt.nets[di] && vt.nets[di][si] !== undefined) return vt.nets[di][si];
    }
    return dropAt(row, dep, share) - (row.fees_usd || 0);
  }
  function verdictAt(row, dep, share) {
    var vt = row.verdict_table;
    if (vt && vt.verdicts) {
      var di = nearestIdx(vt.deposits, dep), si = nearestIdx(vt.shares, share);
      if (di >= 0 && si >= 0 && vt.verdicts[di] && vt.verdicts[di][si]) return vt.verdicts[di][si];
    }
    if (row.verdict && dep === (row.plan_size_usd || 1000) && Math.abs(share - 0.07) < 0.001) return row.verdict;
    var n = netAt(row, dep, share);
    return n > 0 ? 'FARM' : (n > -10 ? 'MARGINAL' : 'SKIP');
  }
  function netSel(row) { return netAt(row, depVal(row), shareVal()); }
  function verdictSel(row) { return verdictAt(row, depVal(row), shareVal()); }
  function vClass(v) { return v === 'FARM' ? 'vfarm' : v === 'MARGINAL' ? 'vmarg' : 'vskip'; }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('q') !== null) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('w') !== null) state.watch = p.get('w') === '1';
    if (p.get('tab') === 'live' || p.get('tab') === 'pre-token') state.tab = p.get('tab');
    if (p.get('verdict')) state.verdict = p.get('verdict');
    if (p.get('dep')) state.dep = p.get('dep');
    if (p.get('share')) state.share = p.get('share');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir') === 'asc' || p.get('dir') === 'desc') state.dir = p.get('dir');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watch) p.set('w', '1');
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.dep !== 'plan') p.set('dep', state.dep);
    if (state.share !== '0.07') p.set('share', state.share);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.sort !== 'rank' && state.dir) p.set('dir', state.dir);
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function matches(r) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
    if (state.watch && !isWatch(r)) return false;
    if (state.verdict !== 'all' && state.tab === 'pre-token' && verdictSel(r) !== state.verdict) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function sortVal(r, key) {
    if (key === 'name') return (r.name || '').toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return (r.change_7d === null || r.change_7d === undefined) ? -1e9 : r.change_7d;
    if (key === 'age') return (r.age_days === null || r.age_days === undefined) ? -1 : r.age_days;
    if (key === 'net') return netSel(r);
    if (key === 'implied') return r.implied_value_usd;
    return r.rank || 0;
  }
  function sorted(list) {
    var key = state.sort, d = state.dir === 'desc' ? -1 : 1;
    return list.slice().sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av < bv) return -d; if (av > bv) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function fillOptions() {
    var cats = {}, chs = {};
    rowsAll.concat(liveAll).forEach(function (r) {
      cats[r.category || 'Other'] = 1; (r.chains || []).forEach(function (c) { chs[c] = 1; });
    });
    $('category').innerHTML = '<option value="all">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    $('chain').innerHTML = '<option value="all">All chains</option>' + Object.keys(chs).sort().map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

  function renderMeta() {
    $('asOf').textContent = 'Snapshot ' + DATA.as_of;
    $('src').textContent = (DATA.source && DATA.source.indexOf('://') >= 0) ? 'DefiLlama protocol index' : (DATA.source || 'DefiLlama protocol index');
    $('modelVer').textContent = (DATA.model_version || 'comps-3') + ' model';
    $('headline').textContent = (DATA.watchlist_size || 40) + ' watchlist protocols, ranked by implied value';
    $('ledeText').textContent = 'Implied value = value if it launches x launch odds, fitted on traded comparables. All ' + DATA.board_size + ' rankable pre-token protocols — ' + (DATA.watchlist_size || 0) + ' watchlist plus ' + (DATA.board_size - (DATA.watchlist_size || 0)) + ' more; ' + rowsAll.filter(function (r) { return r.tvl_usd < DATA.floor_usd; }).length + ' below the ' + fmtUsd(DATA.floor_usd) + ' floor.';
    $('factWatch').textContent = (DATA.watchlist_size || 0) + ' / ' + (DATA.watchlist_size || 0);
    $('factBoard').textContent = String(DATA.board_size);
    $('factEarly').textContent = String(rowsAll.filter(function (r) { return r.tvl_usd < DATA.floor_usd; }).length);
    $('factLive').textContent = String(DATA.live_size || liveAll.length);
    $('formula').textContent = 'implied = round( size_curve x category_premium x launch_odds ), size_curve = 10^' + M.curve_a + ' x forward_tvl^' + M.curve_b + ', forward_tvl = tvl x momentum (7-day change clamped to ' + M.growth_floor + '%–' + M.growth_cap + '%)';
    $('peerNote').textContent = 'Category premium: the median traded comparable\'s mcap / curve prediction in the category, shrunk toward 1 (k = ' + M.peer_shrink_k + ', clamped ' + M.premium_floor + '–' + M.premium_cap + ') — but only with at least ' + M.peer_min_peers + ' live peers; fewer peers earn 1.0. Launch odds: a ridge logistic model (λ = ' + M.odds_logit_lambda + ') of P(has token) on age bins, log TVL, TVL relative to its category, 7-day change, chain count, Ethereum-first, category and first chain; odds = (pEver − F(t)) / (1 − F(t)), clamped ' + M.odds_floor + '–' + M.odds_cap + '.';
    $('liveNote').textContent = 'Live-token protocols sit in their own tab: market cap observed, not modelled.';
  }
  function renderKpi() {
    var k = DATA.kpi || {};
    var total = k.total_implied_usd !== undefined ? k.total_implied_usd : rowsAll.reduce(function (s, r) { return s + (r.implied_value_usd || 0); }, 0);
    var worth = k.worth_farming !== undefined ? k.worth_farming : rowsAll.filter(function (r) { return verdictSel(r) === 'FARM'; }).length;
    var tiles = [
      ['Ranked', String(k.ranked !== undefined ? k.ranked : DATA.board_size), 'no token · ' + (DATA.watchlist_size || 0) + ' watchlist, ' + rowsAll.filter(function (r) { return r.tvl_usd < DATA.floor_usd; }).length + ' below ' + fmtUsd(DATA.floor_usd)],
      ['Implied value', fmtUsd(total), 'over the board'],
      ['Out-of-sample miss', (k.loo_miss !== undefined ? k.loo_miss : k.loo_median_miss) !== undefined ? 'x' + (k.loo_miss !== undefined ? k.loo_miss : k.loo_median_miss).toFixed(2) : 'n/a', 'leave-one-out median miss'],
      ['Range holds', k.range_holds_pct !== undefined ? Math.round(k.range_holds_pct) + '%' : 'n/a', 'of held-out caps inside P10–P90'],
      ['Launch odds, held out', k.launch_odds_accuracy_pct !== undefined ? Math.round(k.launch_odds_accuracy_pct) + '%' : 'n/a', 'held out · base rate ' + (DATA.validation && DATA.validation.launch_odds ? Math.round(DATA.validation.launch_odds.base_rate_pct) + '%' : 'n/a')],
      ['Worth farming', String(worth), 'Farm verdict at plan, 7%, after fees']
    ];
    $('kpi').innerHTML = tiles.map(function (t) { return '<div class="kpi-tile"><span>' + t[0] + '</span><b>' + esc(t[1]) + '</b><small>' + esc(t[2]) + '</small></div>'; }).join('');
  }
  var ACCT_COLORS = ['#f2a93b', '#2dd4a7', '#7aa2f0', '#f26d6d', '#c084fc', '#f472b6', '#94a3b8', '#eab308', '#38bdf8', '#a3e635'];
  function renderAccounting() {
    var acc = DATA.accounting;
    var sec = document.querySelector('.acct');
    if (!acc || !acc.length) { if (sec) sec.style.display = 'none'; return; }
    var total = acc.reduce(function (s, a) { return s + a.count; }, 0);
    $('acctLine').textContent = total + ' read · ' + acc[0].count + ' ranked';
    $('acctBar').innerHTML = acc.map(function (a, i) { return '<i style="width:' + (a.count / total * 100).toFixed(2) + '%;background:' + ACCT_COLORS[i % ACCT_COLORS.length] + '" title="' + esc(a.label) + ' ' + a.count + '"></i>'; }).join('');
    $('acctLegend').innerHTML = acc.map(function (a, i) { return '<li><span class="dot" style="background:' + ACCT_COLORS[i % ACCT_COLORS.length] + '"></span><b>' + a.count + '</b> ' + esc(a.label) + ' — ' + esc(a.reason) + '</li>'; }).join('');
  }

  function th(key, label) {
    var arrow = state.sort === key ? ' <span class="arrow" aria-hidden="true">' + (state.dir === 'desc' ? '↓' : '↑') + '</span>' : '';
    return '<th scope="col" aria-sort="' + (state.sort === key ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none') + '"><button type="button" data-sort="' + key + '">' + label + arrow + '</button></th>';
  }
  function rangeBar(r, max) {
    var lo = r.value_low_usd, hi = r.value_high_usd;
    if (lo === undefined || hi === undefined || !hi) return '<span class="bar" aria-hidden="true"><i style="width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%"></i></span>';
    var w = Math.max(2, Math.round((hi - lo) / max * 100)), left = Math.round(lo / max * 100), at = Math.round(r.implied_value_usd / max * 100);
    return '<span class="rangebar" aria-hidden="true"><i style="left:' + left + '%;width:' + w + '%"></i><b style="left:' + at + '%"></b></span>';
  }
  function renderTable() {
    var pre = state.tab === 'pre-token';
    var list = sorted((pre ? rowsAll : liveAll).filter(function (r) { return matches(r); }));
    $('tabPre').setAttribute('aria-pressed', pre ? 'true' : 'false');
    $('tabLive').setAttribute('aria-pressed', pre ? 'false' : 'true');
    $('caption').textContent = pre
      ? 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.'
      : 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.';
    if (pre) {
      head.innerHTML = '<tr>' + th('rank', 'Rank') + th('name', 'Protocol') + th('tvl', 'TVL') + th('growth', '7d') + th('age', 'Tracked') + th('implied', 'Launch odds') + th('implied', 'Implied value · range') + th('net', 'Net of fees · verdict') + '</tr>';
      var total = list.reduce(function (s, r) { return s + (r.implied_value_usd || 0); }, 0);
      $('count').textContent = list.length + ' of ' + rowsAll.length + ' rows · ' + fmtUsd(total) + ' implied in view · sorted by ' + state.sort;
    } else {
      head.innerHTML = '<tr>' + th('name', 'Protocol') + th('tvl', 'TVL') + th('growth', '7d') + th('tvl', 'Market cap') + '<th scope="col">Token</th></tr>';
      $('count').textContent = list.length + ' of ' + liveAll.length + ' shown (top ' + liveAll.length + ' of ' + (DATA.live_size || liveAll.length) + ' traded)';
    }
    $('empty').hidden = list.length !== 0;
    if (!list.length) { tbody.innerHTML = ''; return; }
    if (pre) {
      var max = rowsAll.reduce(function (m, r) { return Math.max(m, r.value_high_usd || r.implied_value_usd || 0); }, 1);
      tbody.innerHTML = list.map(function (r) {
        var g = r.change_7d === null || r.change_7d === undefined ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
        var v = verdictSel(r), n = netSel(r);
        var range = (r.rank_low !== undefined) ? r.rank + ' · ' + r.rank_low + '–' + r.rank_high : String(r.rank);
        var odds = fmtPct100(chainOf(r).odds);
        return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '" tabindex="0">' +
          '<td><span class="rank-badge">' + r.rank + '</span><div class="sub">' + esc(range) + '</div></td>' +
          '<td><div class="name"><b>' + esc(r.name) + (isWatch(r) ? '<span class="badge">WATCHLIST</span>' : (isAboveFloor(r) ? '<span class="badge">ABOVE FLOOR</span>' : '<span class="badge off">BELOW FLOOR</span>')) + '</b><span class="sub">' + esc(r.category || 'Other') + ' · ' + esc(chainsOf(r).split(', ').slice(0, 2).join(', ')) + '</span></div></td>' +
          '<td class="num">' + esc(fmtUsd(r.tvl_usd)) + '</td>' +
          '<td class="num ' + g + '">' + esc(fmtPct(r.change_7d)) + '</td>' +
          '<td class="num">' + esc(fmtAge(r.age_days)) + '</td>' +
          '<td class="num">' + esc(odds) + '</td>' +
          '<td><div class="implied"><span class="num">' + esc(fmtUsd(r.implied_value_usd)) + '</span>' + rangeBar(r, max) + '<span class="sub">' + esc(fmtUsd(r.value_low_usd)) + ' – ' + esc(fmtUsd(r.value_high_usd)) + '</span></div></td>' +
          '<td><div class="netcell"><span class="num ' + vClass(v) + '">' + esc(fmtNet(n)) + '</span><span class="' + vClass(v) + '">' + esc(v) + '</span></div></td></tr>';
      }).join('');
    } else {
      tbody.innerHTML = list.map(function (r) {
        var g = r.change_7d === null || r.change_7d === undefined ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
        return '<tr class="static"><td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chainsOf(r).split(', ').slice(0, 2).join(', ')) + '</span></div></td>' +
          '<td class="num">' + esc(fmtUsd(r.tvl_usd)) + '</td>' +
          '<td class="num ' + g + '">' + esc(fmtPct(r.change_7d)) + '</td>' +
          '<td class="num">' + esc(fmtUsd(r.mcap_usd)) + '</td>' +
          '<td><span class="chip live">already trades</span></td></tr>';
      }).join('');
    }
  }

  function renderPanels() {
    var v = DATA.validation;
    if (v && v.loo) { var L0 = v.loo;
      if (L0.pct_within_3x !== undefined) L0.within_3x_pct = L0.pct_within_3x;
      if (L0.pct_inside_p25_p75 !== undefined) L0.in_p25_p75_pct = L0.pct_inside_p25_p75;
      if (L0.pct_inside_p10_p90 !== undefined) L0.in_p10_p90_pct = L0.pct_inside_p10_p90;
      if (v.walkforward && v.walkforward.n === undefined) v.walkforward.n = v.walkforward.n_test; }
    var vel = $('valid');
    if (v && v.loo) {
      var caveats = [];
      if (v.loo.in_p25_p75_pct !== undefined && v.loo.in_p25_p75_pct < 45) caveats.push('The P25–P75 band holds only ' + Math.round(v.loo.in_p25_p75_pct) + '% of held-out caps (50% expected) — too narrow.');
      if (v.walkforward && v.walkforward.median_miss > v.loo.median_miss * 1.2) caveats.push('Walk-forward miss (x' + v.walkforward.median_miss.toFixed(2) + ') beats leave-one-out (x' + v.loo.median_miss.toFixed(2) + ') the wrong way: newer tokens are harder to price.');
      if (v.flat_baseline && v.flat_baseline.median_miss <= v.loo.median_miss) caveats.push('Flat baseline (x' + v.flat_baseline.median_miss.toFixed(2) + ') matches the fitted curve — the curve adds little here.');
      if (v.launch_odds && v.launch_odds.accuracy_pct < v.launch_odds.base_rate_pct) caveats.push('Launch odds call fewer right (' + Math.round(v.launch_odds.accuracy_pct) + '%) than the ' + Math.round(v.launch_odds.base_rate_pct) + '% base rate — the odds add no signal here.');
      if (!caveats.length) caveats.push('Small figures miss worst: treat every implied value as a range, not a point.');
      vel.innerHTML = '<p class="sub">Two out-of-sample tests. <b>Each out:</b> each of the ' + (v.loo.n || 0) + ' traded tokens priced from a fit that never saw it. <b>By time:</b> the ' + (v.walkforward ? v.walkforward.n : 0) + ' newest, priced from a fit on the older ones.</p>' +
        '<div class="vstat"><div><span>LOO median miss</span><b>x' + v.loo.median_miss.toFixed(2) + '</b></div><div><span>LOO within 3x</span><b>' + Math.round(v.loo.within_3x_pct) + '%</b></div><div><span>In P25–P75 (expect 50%)</span><b>' + Math.round(v.loo.in_p25_p75_pct) + '%</b></div><div><span>In P10–P90 (expect 80%)</span><b>' + Math.round(v.loo.in_p10_p90_pct) + '%</b></div><div><span>Walk-forward median miss</span><b>x' + (v.walkforward ? v.walkforward.median_miss.toFixed(2) : 'n/a') + '</b></div><div><span>Flat baseline median miss</span><b>x' + (v.flat_baseline ? v.flat_baseline.median_miss.toFixed(2) : 'n/a') + '</b></div></div>' +
        '<p class="sub">Launch odds held out: ' + (v.launch_odds ? Math.round(v.launch_odds.accuracy_pct) + '% called right against a ' + Math.round(v.launch_odds.base_rate_pct) + '% base rate (Brier ' + v.launch_odds.brier.toFixed(4) + ', log-loss ' + v.launch_odds.log_loss.toFixed(4) + '). An exact leave-one-out refit, verified offline, scores 74.41% — the ' + v.launch_odds.accuracy_pct.toFixed(2) + '% shown is a one-step-Newton approximation, slightly pessimistic.' : 'not reported') + '</p>' +
        '<p class="sub">Value ranges use the leave-one-out residual quantiles (q10 ' + v.loo.q10 + ', q90 ' + v.loo.q90 + ') — the typical band spans ' + Math.round(v.loo.q90 / v.loo.q10) + '× from low to high.</p>' +
        '<p class="caveat">Where it is weak: ' + esc(caveats.join(' ')) + '</p>';
    } else vel.innerHTML = '<p class="sub">Validation figures are not in this data file.</p>';
    var pr = $('pricing');
    if (M.curve_a !== undefined) {
      pr.innerHTML = [
        ['Size curve', 'Fitted on ' + (v.loo ? v.loo.n : 119) + ' traded tokens: value = 10^' + M.curve_a + ' x forward TVL^' + M.curve_b + '. Market cap grows sub-linearly with TVL.'],
        ['Momentum', 'Forward TVL carries the 7-day change forward, clamped to ' + M.growth_floor + '%–' + M.growth_cap + '%.'],
        ['Category premium', 'Median mcap / curve prediction over the category\'s live peers, shrunk toward 1 (k = ' + M.peer_shrink_k + ', clamped ' + M.premium_floor + '–' + M.premium_cap + ') — gated: fewer than ' + M.peer_min_peers + ' peers earn 1.0, no premium.'],
        ['Launch odds', 'Ridge logistic P(has token) (λ = ' + M.odds_logit_lambda + ') on age bins, log TVL, TVL vs its category, 7-day change, chain count, Ethereum-first, category and first chain. Odds = (pEver − F(t)) / (1 − F(t)): pEver is the highest P the model gives this protocol at any age, F(t) its P at its own age.'],
        ['Implied value', 'Value if it launches x launch odds. The P10–P90 range is the uncertainty around it.']
      ].map(function (s) { return '<li><b>' + s[0] + '</b>' + esc(s[1]) + '</li>'; }).join('');
    } else {
      pr.innerHTML = '<li><b>Category multiple</b>Median FDV/TVL of live peers in the category, or the global median.</li><li><b>Growth</b>7-day change, clamped and weighted.</li><li><b>Maturity</b>Older with no token scores closer to full value.</li><li><b>Implied value</b>TVL x multiple x growth x maturity.</li><li><b>Farm check</b>Worth farming only when the modelled drop clears the fees.</li>';
    }
    var cats = DATA.categories;
    var cel = $('cats');
    if (cats && cats.length) {
      var top = cats.slice().sort(function (a, b) { return b.rows - a.rows; }).slice(0, 10);
      cel.innerHTML = '<table class="mini"><thead><tr><th scope="col">Category</th><th scope="col">Rows</th><th scope="col">With token</th><th scope="col">Ever %</th><th scope="col">Premium</th></tr></thead><tbody>' +
        top.map(function (c) { return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.rows + '</td><td class="num">' + c.with_token + '</td><td class="num">' + Math.round(c.ever_pct) + '%</td><td class="num">' + fmtMult(c.premium) + '</td></tr>'; }).join('') + '</tbody></table>';
    } else cel.innerHTML = '<p class="sub">Category split is not in this data file.</p>';
    renderScatter();
  }
  function renderScatter() {
    var el = $('scatter');
    var pts = [];
    liveAll.forEach(function (r) { if (r.tvl_usd > 0 && r.mcap_usd > 0) pts.push({ x: r.tvl_usd, y: r.mcap_usd, live: true }); });
    rowsAll.forEach(function (r) { if (r.tvl_usd > 0 && r.implied_value_usd > 0) pts.push({ x: r.tvl_usd, y: r.implied_value_usd, live: false }); });
    if (pts.length < 4) { el.innerHTML = '<p class="sub">Not enough points to draw.</p>'; return; }
    var xs = pts.map(function (p) { return Math.log10(p.x); }), ys = pts.map(function (p) { return Math.log10(p.y); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var W = 560, H = 260, PL = 44, PB = 24, PT = 8, PR = 8;
    function X(v) { return PL + (Math.log10(v) - x0) / (x1 - x0) * (W - PL - PR); }
    function Y(v) { return PT + (y1 - Math.log10(v)) / (y1 - y0) * (H - PT - PB); }
    var s = '';
    for (var gx = x0; gx <= x1; gx++) { var xv = Math.pow(10, gx); s += '<line x1="' + X(xv).toFixed(1) + '" y1="' + PT + '" x2="' + X(xv).toFixed(1) + '" y2="' + (H - PB) + '" stroke="#26344f" stroke-width="1"/><text class="ax" x="' + X(xv).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">$' + (gx >= 9 ? (gx - 9) + 'B' : (gx - 6) + 'M') + '</text>'; }
    for (var gy = y0; gy <= y1; gy++) { var yv = Math.pow(10, gy); s += '<line x1="' + PL + '" y1="' + Y(yv).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(yv).toFixed(1) + '" stroke="#26344f" stroke-width="1"/><text class="ax" x="' + (PL - 4) + '" y="' + (Y(yv) + 3).toFixed(1) + '" text-anchor="end">$' + (gy >= 9 ? (gy - 9) + 'B' : gy >= 6 ? (gy - 6) + 'M' : (gy - 3) + 'K') + '</text>'; }
    var curve = '';
    if (M.curve_a !== undefined && M.curve_b !== undefined) {
      var d = [];
      for (var i = 0; i <= 24; i++) { var fx = Math.pow(10, x0 + (x1 - x0) * i / 24); var fy = curveVal(fx, null); if (fy && fy > 0) d.push((i ? 'L' : 'M') + X(fx).toFixed(1) + ',' + Y(fy).toFixed(1)); }
      curve = '<path d="' + d.join(' ') + '" fill="none" stroke="#f2a93b" stroke-width="1.5" stroke-dasharray="5 4"/>';
    }
    var dots = pts.map(function (p) { return '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (p.live ? 3 : 2.5) + '" fill="' + (p.live ? '#2dd4a7' : '#f2a93b') + '" opacity="' + (p.live ? 0.85 : 0.6) + '"/>'; }).join('');
    el.innerHTML = '<div class="scatter"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of value against TVL on log scales">' + s + curve + dots + '</svg><p class="sub">Teal: traded tokens, market cap. Amber: pre-token rows, implied value. Dashed: fitted size curve.</p></div>';
  }

  function whyRank(row) {
    var c = chainOf(row);
    var tvlRank = 1 + rowsAll.filter(function (r) { return r.tvl_usd > row.tvl_usd; }).length;
    var pct = Math.max(1, Math.round(tvlRank / rowsAll.length * 100));
    var range = (row.rank_low !== undefined && row.rank_high !== undefined) ? ' Its P10–P90 range puts it at rank ' + row.rank_low + '–' + row.rank_high + '.' : '';
    return 'Rank <b>#' + row.rank + '</b> because its ' + esc(fmtUsd(row.tvl_usd)) + ' TVL is <b>#' + tvlRank + ' of ' + rowsAll.length + '</b> (top ' + pct + '%), its ' + esc(row.category || 'Other') + ' premium is <b>' + esc(fmtMult(c.premium)) + '</b>, its launch odds are <b>' + esc(fmtPct100(c.odds)) + '</b> after ' + esc(fmtAge(row.age_days)) + ' with no token, and its 7-day momentum is <b>' + esc(fmtMult(c.mom)) + '</b>.' + range;
  }
  function openDetail(slug) {
    var row = null;
    rowsAll.some(function (r) { if (r.slug === slug) { row = r; return true; } return false; });
    if (!row) return;
    state.selected = slug; writeHash();
    var c = chainOf(row), re = c.imp, ok = Math.abs(re - row.implied_value_usd) <= Math.max(2000, row.implied_value_usd * 0.005);
    var dep = depVal(row), share = shareVal(), net = netSel(row);
    var slice = c.val * share * dep / Math.max(1, row.tvl_usd);
    var be = slice > 0 ? (row.fees_usd || 0) / slice : null;
    var nph = (row.time_hours && row.time_hours > 0) ? net / row.time_hours : null;
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b>' + (tail ? '<span class="cost">' + esc(tail) + '</span>' : '') + '</li>';
    }).join('');
    var comps = row.comparables || [];
    var compHtml = comps.length ? '<table class="mini comp"><thead><tr><th scope="col">Token that trades</th><th scope="col">TVL</th><th scope="col">MCAP</th><th scope="col">x TVL</th><th scope="col">Applied here</th></tr></thead><tbody>' +
      comps.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + esc(fmtUsd(p.tvl_usd)) + '</td><td class="num">' + esc(fmtUsd(p.mcap_usd)) + '</td><td class="num">' + esc(fmtMult(p.multiple)) + '</td><td class="num">' + esc(fmtUsd(p.applied_usd)) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<p class="sub">No nearest comparables in this data file.</p>';
    var vt = row.verdict_table;
    var deps = vt && vt.deposits ? vt.deposits : [1000, row.plan_size_usd || 1000, 10000];
    var shares = vt && vt.shares ? vt.shares : [0.035, 0.07, 0.14];
    var vtHtml = '<table class="vt"><thead><tr><th scope="col">Drop share \\ deposit</th>' + deps.map(function (d) { return '<th scope="col">' + esc(fmtUsd(d)) + (d === (row.plan_size_usd || 1000) ? ' (plan)' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      shares.map(function (sh) {
        return '<tr><td>' + Math.round(sh * 1000) / 10 + '%</td>' + deps.map(function (d) {
          var nn = netAt(row, d, sh), vv = verdictAt(row, d, sh);
          var sel = Math.abs(d - dep) < 1 && Math.abs(sh - share) < 0.0001;
          return '<td' + (sel ? ' class="sel"' : '') + '><span class="num ' + vClass(vv) + '">' + esc(fmtNet(nn)) + '</span><span class="' + vClass(vv) + '">' + esc(vv) + '</span></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    var chainRows =
      '<div><span>TVL in the snapshot</span><b class="num">' + esc(fmtUsd(row.tvl_usd)) + '</b></div>' +
      '<div><span>Forward TVL (x ' + esc(fmtMult(c.mom)) + ' momentum)</span><b class="num">' + esc(fmtUsd(c.fwd)) + '</b></div>' +
      '<div><span>Size curve' + (M.curve_a !== undefined ? ' (' + (M.curve_a > 1 ? '10^' : 'exp(') + M.curve_a + (M.curve_a > 1 ? '' : ')') + ' x forward^' + M.curve_b + ')' : '') + '</span><b class="num">' + esc(fmtUsd(c.size)) + '</b></div>' +
      '<div><span>Category premium</span><b class="num">x ' + esc(fmtMult(c.premium)) + '</b></div>' +
      '<div><span>Value if it launches</span><b class="num">' + esc(fmtUsd(c.val)) + '</b></div>' +
      '<div><span>Launch odds</span><b class="num">x ' + esc(fmtPct100(c.odds)) + '</b></div>';
    dialog.innerHTML =
      '<div class="detail-head"><div><span class="brand-name">RANK ' + row.rank + ' OF ' + DATA.board_size + (row.rank_low !== undefined ? ' · RANGE ' + row.rank_low + '–' + row.rank_high : '') + '</span>' +
      '<h2 id="detailTitle">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc(chainsOf(row)) + (isWatch(row) ? ' · on the watchlist' : (isAboveFloor(row) ? ' · above the floor' : ' · below the floor')) + '</p>' +
      '<p style="margin-top:8px"><span style="font-size:26px;color:var(--amber);font-family:var(--font-num);font-weight:600">' + esc(fmtUsd(row.implied_value_usd)) + '</span> <span class="sub">implied value · ' + esc(fmtUsd(row.value_low_usd)) + ' – ' + esc(fmtUsd(row.value_high_usd)) + ' range</span></p></div>' +
      '<button class="close" type="button" aria-label="Close details">Close</button></div>' +
      '<section class="detail-section"><h3>How the figure is made</h3><div class="chain">' + chainRows +
      '<div class="total"><span>Implied value</span><b class="num">' + esc(fmtUsd(row.implied_value_usd)) + '</b></div></div>' +
      '<p class="check ' + (ok ? 'ok' : 'bad') + '">Recomputed on this page: impliedOf gives ' + esc(fmtUsd(re)) + (ok ? ' — the same number board.json carries.' : ' — WARNING: this differs from the board value ' + esc(fmtUsd(row.implied_value_usd)) + '; the data would be stale.') + '</p>' +
      '<p class="why">Why this rank: ' + whyRank(row) + '</p></section>' +
      '<section class="detail-section"><h3>Nearest traded comparables</h3>' + compHtml + '</section>' +
      '<section class="detail-section"><h3>Verdict table — net of fees</h3>' + vtHtml +
      '<p class="sub" style="margin-top:8px">Now: ' + esc(fmtUsd(dep)) + ' deposit, ' + Math.round(share * 1000) / 10 + '% drop share — net <b class="' + vClass(verdictSel(row)) + '">' + esc(fmtNet(net)) + ' · ' + esc(verdictSel(row)) + '</b>.</p></section>' +
      '<section class="detail-section"><h3>Farm plan</h3><ol class="steps">' + steps + '</ol>' +
      '<div class="arith"><div><span>At risk</span><b>' + esc(fmtUsd(dep)) + '</b></div><div><span>Fees</span><b>' + esc(fmtUsd(row.fees_usd)) + '</b></div><div><span>Your time</span><b>' + (row.time_hours !== undefined ? row.time_hours + ' h' : 'n/a') + '</b></div><div><span>Slice if it launches</span><b>' + esc(fmtNet(slice)) + '</b></div><div><span>Break-even odds</span><b>' + (be !== null ? Math.round(be * 100) + '%' : 'n/a') + '</b></div><div><span>Net per hour</span><b>' + (nph !== null ? esc(fmtNet(nph)) + '/h' : 'n/a') + '</b></div></div>' +
      '<p class="sub" style="margin-top:8px">Slice if launch = value if it launches x drop share x deposit / TVL. Break-even odds = fees / slice. Net per hour = net at the current selection / time.</p></section>';
    dialog.querySelector('.close').addEventListener('click', function () { dialog.close(); });
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() { renderTable(); }
  function syncControls() {
    $('q').value = state.q; $('watch').checked = state.watch;
    $('verdict').value = state.verdict; $('sortSel').value = state.sort;
    if ($('category').value !== state.category) $('category').value = state.category;
    if ($('chain').value !== state.chain) $('chain').value = state.chain;
    Array.prototype.forEach.call(document.querySelectorAll('#depSeg button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dep') === state.dep ? 'true' : 'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('#shareSeg button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-share') === state.share ? 'true' : 'false'); });
  }
  readHash();
  renderMeta(); renderKpi(); renderAccounting(); fillOptions(); syncControls(); render(); renderPanels();
  app.setAttribute('aria-busy', 'false');
  if (state.selected) openDetail(state.selected);

  $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); render(); });
  $('category').addEventListener('change', function () { state.category = $('category').value; writeHash(); render(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); render(); });
  $('watch').addEventListener('change', function () { state.watch = $('watch').checked; writeHash(); render(); });
  $('verdict').addEventListener('change', function () { state.verdict = $('verdict').value; writeHash(); render(); });
  $('sortSel').addEventListener('change', function () { state.sort = $('sortSel').value; state.dir = (state.sort === 'name') ? 'asc' : 'desc'; if (state.sort === 'rank') state.dir = 'asc'; writeHash(); render(); });
  $('depSeg').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('button[data-dep]') : null; if (!b) return; state.dep = b.getAttribute('data-dep'); writeHash(); syncControls(); render(); });
  $('shareSeg').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('button[data-share]') : null; if (!b) return; state.share = b.getAttribute('data-share'); writeHash(); syncControls(); render(); });
  $('tabPre').addEventListener('click', function () { state.tab = 'pre-token'; state.sort = 'rank'; state.dir = 'asc'; writeHash(); syncControls(); render(); });
  $('tabLive').addEventListener('click', function () { state.tab = 'live'; state.sort = 'tvl'; state.dir = 'desc'; writeHash(); syncControls(); render(); });
  $('clearFilters').addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; state.verdict = 'all'; syncControls(); fillOptions(); writeHash(); render(); });
  head.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-sort]') : null;
    if (!b) return;
    var k = b.getAttribute('data-sort');
    if (state.sort === k) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
    else { state.sort = k; state.dir = (k === 'name' || k === 'rank') ? 'asc' : 'desc'; }
    syncControls(); render();
  });
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  tbody.addEventListener('keydown', function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); }
  });
  dialog.addEventListener('close', function () { if (state.selected) { state.selected = null; writeHash(); render(); } });
  window.addEventListener('hashchange', function () { readHash(); syncControls(); fillOptions(); render(); if (state.selected) openDetail(state.selected); });
})();
