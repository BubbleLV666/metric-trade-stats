/* Metric Trade Stats: reads the swaps and liquidity events of one wallet from the chain, in the browser. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const API = 'https://api.metric.xyz/public/v1';
  /* the official Robinhood RPC allows browsers and 30000 blocks per request when only the wallet is filtered */
  const CHAINS = {
    4663: { name: 'Robinhood', rpc: 'https://rpc.mainnet.chain.robinhood.com', step: 30000, ex: 'https://robin.etherscan.io' },
    1: { name: 'Ethereum', rpc: '', step: 5000, ex: 'https://etherscan.io' },
    56: { name: 'BNB Smart Chain', rpc: '', step: 5000, ex: 'https://bscscan.com' },
  };
  const T = {
    Swap: '0x9734819749a91fc3be03ea83205f924ee08479bd3f0da48efc91d94d050cac1e',
    Added: '0xa55772434bee2a347743b1e8086fa44bac69a060e124ec92ab6b9cc7fc5268af',
    Removed: '0xf53d04bdbda6d88dd536895ec533833d3e09d0cbe2474fae32a368c5f83fc610',
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('metric_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('metric_' + k, JSON.stringify(v)); } catch (e) { } },
  };

  /* ---------- formatting */
  const fmt = (x, d = 2) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = x => (x < 0 ? '−' : '') + '$' + fmt(Math.abs(x), 2);
  const tok = x => { const a = Math.abs(x); return fmt(x, a >= 100 ? 2 : a >= 1 ? 4 : a === 0 ? 0 : 6); };
  const p2 = x => String(x).padStart(2, '0');
  const dt = ms => { if (!ms) return '—'; const d = new Date(ms); return `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
  const day = ms => { const d = new Date(ms); return `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}`; };
  const short = a => a.slice(0, 6) + '…' + a.slice(-4);

  /* ---------- RPC */
  async function rpc(url, payload) {
    let last = 'no answer';
    for (let a = 0; a < 8; a++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await r.json(), arr = Array.isArray(j) ? j : [j];
        const bad = arr.find(x => x && x.error && /429|too many|rate|limit exceeded/i.test(x.error.code + ' ' + x.error.message));
        if (!bad) return j;
        last = bad.error.message;
      } catch (e) { last = e.message; }
      await sleep(800 * (a + 1));
    }
    throw new Error('RPC does not answer (' + last + ')');
  }
  async function call(url, method, params) { const j = await rpc(url, { jsonrpc: '2.0', id: 1, method, params }); if (j.error) throw new Error(j.error.message); return j.result; }
  async function batch(url, method, list, onStep) {
    const out = new Array(list.length).fill(null), SZ = 20;
    for (let i = 0; i < list.length; i += SZ) {
      const part = list.slice(i, i + SZ), j = await rpc(url, part.map((p, k) => ({ jsonrpc: '2.0', id: i + k, method, params: p })));
      (Array.isArray(j) ? j : [j]).forEach(x => { if (x && x.id != null && !x.error) out[x.id] = x.result; });
      if (onStep) onStep(Math.min(i + SZ, list.length), list.length);
    }
    return out;
  }

  /* ---------- Metric pools */
  const POOLS = {};
  async function loadPools(chainId) {
    if (POOLS[chainId]) return POOLS[chainId];
    let all = [];
    for (let off = 0; ;) {
      const r = await fetch(`${API}/evm/${chainId}/metadata?minTvlFiat=0&count=500&offset=${off}`);
      if (!r.ok) throw new Error('Metric API answered ' + r.status);
      const d = await r.json(); all = all.concat(d.data || []);
      if (d.nextOffset == null || !(d.data || []).length) break; off = d.nextOffset;
    }
    return POOLS[chainId] = new Map(all.map(p => [p.poolAddress.toLowerCase(), p]));
  }

  /* volume of the whole platform: the sum over the pools of all three networks */
  async function loadPlatform() {
    try {
      const ids = [4663, 1, 56], all = await Promise.all(ids.map(loadPools)), W = ['24h', '7d', '30d'];
      const per = all.map(m => W.map(k => [...m.values()].reduce((b, p) => b + ((p.volumeByWindow && p.volumeByWindow[k]) || 0), 0))), tot = W.map((k, i) => per.reduce((a, r) => a + r[i], 0)), d = v => '$' + fmt(v, 0);
      $('#platVol24').textContent = d(tot[0]); $('#platVol7').textContent = d(tot[1]);
      $('#platTip').innerHTML = '<table><thead><tr><th class="l">Network</th><th>24h</th><th>7d</th><th>30d</th></tr></thead><tbody>' + ids.map((id, i) => `<tr><td class="l">${CHAINS[id].name} <span class="muted">· ${all[i].size} pools</span></td>${per[i].map(v => `<td class="num">${d(v)}</td>`).join('')}</tr>`).join('') + '</tbody><tfoot><tr><td class="l">All networks</td>' + tot.map(v => `<td class="num">${d(v)}</td>`).join('') + '</tr></tfoot></table>';
      $('#plat').hidden = false;
    } catch (e) { }
  }

  /* current positions of the wallet: the Metric API returns them for any address (CORS open) */
  async function loadPositions(cid, wallet, pools) {
    try {
      const r = await fetch(`${API}/evm/${cid}/positions/${wallet}`); if (!r.ok) return [];
      return (await r.json()).map(x => {
        const p = pools.get(x.poolAddress.toLowerCase()); if (!p) return null;
        const n0 = Number(x.token0Amount) / 10 ** p.token0Decimals, n1 = Number(x.token1Amount) / 10 ** p.token1Decimals, d0 = Number(x.totalAmount0Delta) / 1e18, d1 = Number(x.totalAmount1Delta) / 1e18, f0 = x.token0FiatPrice, f1 = x.token1FiatPrice, pc = v => (v > 0 ? '+' : '') + fmt(v * 100, 2) + '%';
        return { pool: p.poolAddress, pair: p.pair, s0: p.token0Symbol, s1: p.token1Symbol, n0, n1, f0, f1, now: n0 * f0 + n1 * f1, net: d0 * f0 + d1 * f1, salt: x.salt, last: Number(x.lastModifiedTimestamp) * 1000, range: x.range ? pc(x.range.lowerOffsetRatio) + ' … ' + pc(x.range.upperOffsetRatio) : '' };
      }).filter(Boolean);
    } catch (e) { return []; }
  }

  /* ---------- decoding */
  const s256 = x => (x >= (1n << 255n) ? x - (1n << 256n) : x), s128 = x => (x >= (1n << 127n) ? x - (1n << 128n) : x);
  function decodeSwap(lg) {                  // data: details, amountDeltas (int128 delta0 | int128 delta1 in raw token units; + = into the pool), platformFees
    const d = lg.data.slice(2), ad = BigInt('0x' + d.slice(64, 128));
    return { d0: s128(ad >> 128n), d1: s128(ad & ((1n << 128n) - 1n)) };
  }
  function decodeLiquidity(lg) {             // data: offsets, binIdxs[], (delta0, delta1)[] scaled to 18 decimals, shares[]
    const hex = lg.data.slice(2), W = i => BigInt('0x' + hex.slice(i * 64, (i + 1) * 64)), o2 = Number(W(1) / 32n), cnt = Number(W(o2));
    let a0 = 0n, a1 = 0n;
    for (let i = 0; i < cnt; i++) { a0 += s256(W(o2 + 1 + 2 * i)); a1 += s256(W(o2 + 2 + 2 * i)); }
    return { a0: Number(a0) / 1e18, a1: Number(a1) / 1e18, salt: BigInt(lg.topics[2]).toString() };
  }

  /* ---------- analysis of the receipts of the wallet's transactions */
  function analyze(recs, wallet, pools, ts) {
    const swaps = [], liq = [], R = { txs: 0, foreign: 0, missing: 0, gasEth: 0 };
    for (const r of recs) {
      if (!r) { R.missing++; continue; }
      if (r.status !== '0x1') continue;
      if (wallet && r.from.toLowerCase() !== wallet) { R.foreign++; continue; }
      const evs = r.logs.filter(l => pools.has(l.address.toLowerCase()) && (l.topics[0] === T.Swap || l.topics[0] === T.Added || l.topics[0] === T.Removed));
      if (!evs.length) continue;
      const block = parseInt(r.blockNumber, 16), time = ts[block] || null;
      R.txs++; R.gasEth += parseInt(r.gasUsed, 16) * parseInt(r.effectiveGasPrice || '0x0', 16) / 1e18;
      for (const lg of evs) {
        const p = pools.get(lg.address.toLowerCase()), base = { tx: r.transactionHash, block, time, pool: p.poolAddress, pair: p.pair, s0: p.token0Symbol, s1: p.token1Symbol, f0: p.token0FiatPrice, f1: p.token1FiatPrice, li: Number(lg.logIndex) };
        if (lg.topics[0] === T.Swap) {
          const { d0, d1 } = decodeSwap(lg), a0 = Number(d0) / 10 ** p.token0Decimals, a1 = Number(d1) / 10 ** p.token1Decimals;
          const v0 = Math.abs(a0) * p.token0FiatPrice, v1 = Math.abs(a1) * p.token1FiatPrice;
          swaps.push({ ...base, a0, a1, usd: (v0 + v1) / 2 });
        } else {
          const { a0, a1, salt } = decodeLiquidity(lg), added = lg.topics[0] === T.Added;
          liq.push({ ...base, kind: added ? 'added' : 'removed', a0: Math.abs(a0), a1: Math.abs(a1), usd: Math.abs(a0) * p.token0FiatPrice + Math.abs(a1) * p.token1FiatPrice, salt });
        }
      }
    }
    return { swaps, liq, R };
  }

  /* ---------- state + UI */
  let CUR = null;
  /* period filter: applies to swaps (volume, history, chart); the liquidity positions are always the current ones */
  const PERIODS = { '24h': ['24 hours', 864e5], '7d': ['7 days', 7 * 864e5], '30d': ['30 days', 30 * 864e5], all: ['All time', 0] };
  let PERIOD = PERIODS[store.get('period', 'all')] ? store.get('period', 'all') : 'all';
  const PV = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', all: 'All time' };
  let POOLVOL = PV[store.get('poolvol', '24h')] ? store.get('poolvol', '24h') : '24h';
  const periodText = () => PERIOD === 'all' ? 'all time' : 'last ' + PERIODS[PERIOD][0];
  function renderPeriodbar() {
    $('#periodbar').innerHTML = Object.entries(PERIODS).map(([k, v]) => `<button class="pbtn${k === PERIOD ? ' on' : ''}" data-p="${k}" type="button">${v[0]}</button>`).join('') + '<span class="pdesc">applies to swaps; liquidity is always the current state</span>';
  }
  const setStatus = (html, kind) => { const el = $('#status'); el.className = 'status' + (kind ? ' ' + kind : ''); el.innerHTML = html; };
  const bar = (done, total, label) => `${label} <span class="bar"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></span> ${fmt(done, 0)} / ${fmt(total, 0)}`;
  const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a);
  const chainId = () => Number($('#chain').value);
  const rpcUrl = () => (CHAINS[chainId()].rpc || $('#rpcUrl').value.trim());

  function chainChanged() {
    const c = CHAINS[chainId()];
    $('#rpcUrl').hidden = !!c.rpc;
    $('#rpcUrl').value = store.get('rpc_' + chainId(), '');
  }

  async function timestamps(url, blocks, onStep) {
    const uniq = [...new Set(blocks)], res = await batch(url, 'eth_getBlockByNumber', uniq.map(b => ['0x' + b.toString(16), false]), onStep), ts = {};
    uniq.forEach((b, i) => { if (res[i]) ts[b] = parseInt(res[i].timestamp, 16) * 1000; });
    return ts;
  }

  /* hashes -> receipts -> dashboard */
  async function fromHashes(hashes, wallet, how) {
    const cid = chainId(), url = rpcUrl();
    if (!url) { setStatus('This network needs an RPC URL that allows browser access: enter it in the field above.', 'err'); return; }
    setStatus('<i class="spin"></i>Loading the Metric pool list…', 'busy');
    const pools = await loadPools(cid);
    const recs = await batch(url, 'eth_getTransactionReceipt', hashes.map(h => [h]), (d, t) => setStatus(bar(d, t, 'Reading transactions'), 'busy'));
    const blocks = recs.filter(r => r && r.status === '0x1').map(r => parseInt(r.blockNumber, 16));
    const ts = await timestamps(url, blocks, (d, t) => setStatus(bar(d, t, 'Reading block times'), 'busy'));
    const A = analyze(recs, wallet, pools, ts);
    CUR = { wallet, cid, how, hashes: hashes.length, ...A, pos: await loadPositions(cid, wallet, pools), at: Date.now() };
    store.set('hashes_' + cid + '_' + wallet, hashes);
    rememberWallet(wallet);
    setStatus('');
    render();
  }

  /* quick view: only the current positions (no history needed) */
  async function showPositions(wallet) {
    const cid = chainId(); setStatus('<i class="spin"></i>Loading positions…', 'busy');
    const pools = await loadPools(cid), pos = await loadPositions(cid, wallet, pools);
    CUR = { wallet, cid, partial: true, how: '', hashes: 0, swaps: [], liq: [], R: { txs: 0, foreign: 0, missing: 0, gasEth: 0 }, pos, at: Date.now() };
    rememberWallet(wallet); setStatus(''); render();
  }

  /* ---------- wallet memory */
  function rememberWallet(w) { const l = store.get('recent', []).filter(x => x !== w); l.unshift(w); store.set('recent', l.slice(0, 6)); renderRecent(); }
  function renderRecent() { $('#recent').innerHTML = store.get('recent', []).map(a => `<button class="chip" type="button" data-a="${a}">${short(a)}</button>`).join(''); }

  /* ---------- dashboard */
  function render() {
    const C = CUR, ex = CHAINS[C.cid].ex, R = C.R, cut = PERIODS[PERIOD][1] ? Date.now() - PERIODS[PERIOD][1] : 0, inP = e => !cut || (e.time || 0) >= cut, swaps = C.swaps.filter(inP), liq = C.liq.filter(inP);
    $('#welcome').hidden = true; closeHowto();
    const link = (t, h) => `<a href="${ex}/tx/${h}" target="_blank" rel="noopener">${t}</a>`;
    const vol = swaps.reduce((a, s) => a + s.usd, 0), big = swaps.reduce((m, s) => Math.max(m, s.usd), 0);
    const added = liq.filter(l => l.kind === 'added').reduce((a, l) => a + l.usd, 0), removed = liq.filter(l => l.kind === 'removed').reduce((a, l) => a + l.usd, 0);
    const first = [...swaps, ...liq].reduce((m, e) => e.time && (!m || e.time < m) ? e.time : m, 0), last = [...swaps, ...liq].reduce((m, e) => e.time && e.time > m ? e.time : m, 0);

    /* positions: the current ones come from the Metric API; pools without a current position come from the events */
    const POS = C.pos || [];
    const P = new Map();
    const row = (pool, pair, s0, s1) => { const k = pool.toLowerCase(); if (!P.has(k)) P.set(k, { pool, pair, s0, s1, now: 0, net: 0, n0: 0, n1: 0, np: 0, evNet: 0, swaps: 0, vol: 0, last: 0, range: '' }); return P.get(k); };
    POS.forEach(p => { const r = row(p.pool, p.pair, p.s0, p.s1); r.now += p.now; r.net += p.net; r.n0 += p.n0; r.n1 += p.n1; r.np++; r.range = p.range; r.last = Math.max(r.last, p.last); });
    swaps.forEach(s => { const r = row(s.pool, s.pair, s.s0, s.s1); r.swaps++; r.vol += s.usd; r.last = Math.max(r.last, s.time || 0); });
    liq.forEach(l => { const r = row(l.pool, l.pair, l.s0, l.s1); r.evNet += (l.kind === 'added' ? 1 : -1) * l.usd; r.last = Math.max(r.last, l.time || 0); });
    const pools = [...P.values()].sort((a, b) => (b.now - a.now) || (b.vol - a.vol));
    const nowTotal = POS.reduce((a, p) => a + p.now, 0), netTotal = POS.reduce((a, p) => a + p.net, 0), pnlTotal = nowTotal - netTotal;
    const sg = x => (x > 0 ? '+' : '') + usd(x), cl = x => x > 0.005 ? 'pos' : x < -0.005 ? 'neg' : '';

    /* tokens held now */
    const TK = new Map();
    POS.forEach(p => { [[p.s0, p.n0, p.f0], [p.s1, p.n1, p.f1]].forEach(([s, v, f]) => { const t = TK.get(s) || { v: 0, f }; t.v += v; TK.set(s, t); }); });
    const tokRows = [...TK.entries()].filter(([, t]) => Math.abs(t.v) > 1e-9).map(([s, t]) => `<div class="row"><span>${esc(s)}</span><b class="num">${tok(t.v)} <span class="muted">· ${usd(t.v * t.f)}</span></b></div>`).join('') || '<div class="muted">no open positions</div>';
    const tokTotal = [...TK.values()].reduce((a, t) => a + t.v * t.f, 0);

    /* swaps by day */
    const D = new Map(); swaps.forEach(s => { if (!s.time) return; const k = Math.floor(s.time / 864e5); D.set(k, (D.get(k) || 0) + s.usd); });
    let chart = '<div class="empty">No swaps</div>';
    if (D.size) {
      const ks = [...D.keys()].sort((a, b) => a - b), k0 = ks[0], k1 = ks[ks.length - 1], span = Math.min(k1 - k0 + 1, 120), mx = Math.max(...D.values()), W = 600, H = 150, bw = Math.max(4, Math.min(40, W / span - 3));
      chart = `<svg class="barchart" viewBox="0 0 ${W} ${H + 22}">` + ks.slice(-120).map(k => {
        const h = Math.max(2, D.get(k) / mx * H), x = (k - Math.max(k0, k1 - 119)) * (W / span);
        return `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${day(k * 864e5)}: ${usd(D.get(k))}</title></rect>`;
      }).join('') + `<text x="0" y="${H + 16}">${day(Math.max(k0, k1 - 119) * 864e5)}</text><text x="${W}" y="${H + 16}" text-anchor="end">${day(k1 * 864e5)}</text></svg>`;
    }

    /* history */
    const hist = [...swaps.map(s => ({ ...s, type: 'swap' })), ...liq.map(l => ({ ...l, type: l.kind }))].sort((a, b) => (b.time || 0) - (a.time || 0) || b.block - a.block || b.li - a.li);
    const desc = e => {
      if (e.type === 'swap') { const pay = e.a0 > 0 ? [e.a0, e.s0] : [e.a1, e.s1], get = e.a0 > 0 ? [-e.a1, e.s1] : [-e.a0, e.s0]; return `${tok(pay[0])} ${esc(pay[1])} → ${tok(get[0])} ${esc(get[1])}`; }
      return `${tok(e.a0)} ${esc(e.s0)} + ${tok(e.a1)} ${esc(e.s1)} <span class="muted">· position ${esc(e.salt.slice(-6))}</span>`;
    };

    const PM = POOLS[C.cid] || new Map(), pv = a => { const p = PM.get(a.toLowerCase()), v = p && p.volumeByWindow && p.volumeByWindow[POOLVOL]; return v == null ? '—' : usd(v); };
    const swapHist = hist.filter(e => e.type === 'swap');
    const note = [];
    if (R.foreign) note.push(`${R.foreign} transactions in the list were sent by other addresses and are ignored.`);
    if (R.missing) note.push(`${R.missing} transactions could not be read from the RPC.`);
    const part = C.partial, hold = '<div class="muted" style="margin-top:10px">Load the explorer CSV (button above) to see your swaps and their history.</div>';

    $('#out').innerHTML = `
      <div class="hdr"><code>${esc(C.wallet)}</code><a href="${ex}/address/${C.wallet}" target="_blank" rel="noopener">explorer ↗</a><span class="muted">${CHAINS[C.cid].name} · ${part ? 'current positions from the Metric API' : `${fmt(C.hashes, 0)} transactions checked (${esc(C.how)}) · ${fmt(R.txs, 0)} of them used Metric`}</span></div>
      <section class="card w4"><h2>Your liquidity<span class="sub">now</span></h2><div class="big num">${usd(nowTotal)}</div>
        <div class="kpis"><div>Net deposited<b class="num">${usd(netTotal)}</b></div><div>Position P&amp;L<b class="num ${cl(pnlTotal)}">${sg(pnlTotal)}</b></div><div>Positions<b class="num">${POS.length}</b></div></div></section>
      <section class="card w4"><h2>Swap volume<span class="sub">on Metric · ${periodText()}</span></h2>${part ? hold : `<div class="big num">${usd(vol)}</div>
        <div class="kpis"><div>Swaps<b class="num">${fmt(swaps.length, 0)}</b></div><div>Average swap<b class="num">${swaps.length ? usd(vol / swaps.length) : '—'}</b></div><div>Largest swap<b class="num">${usd(big)}</b></div></div>`}</section>
      <section class="card w4"><h2>Liquidity by token<span class="sub">held now</span></h2><div class="rows">${tokRows}<div class="row tot"><span>Total</span><b class="num">${usd(tokTotal)}</b></div></div></section>
      ${part ? '' : `<section class="card w8"><h2>Swap volume by day<span class="sub">UTC</span></h2>${chart}</section>
      <section class="card w4"><h2>Activity</h2><div class="rows"><div class="row"><span>First Metric action</span><b class="num">${dt(first)}</b></div><div class="row"><span>Last Metric action</span><b class="num">${dt(last)}</b></div><div class="row"><span>Gas paid (all loaded transactions)</span><b class="num">${tok(R.gasEth)} ETH</b></div><div class="row"><span>Transactions with Metric (all loaded)</span><b class="num">${fmt(R.txs, 0)}</b></div></div></section>`}
      <section class="card w12"><h2>Pools<span class="sub">pools where you hold liquidity or traded</span><span class="seg" style="margin-left:10px" title="Volume of the whole pool (all traders)">${Object.entries(PV).map(([k, v]) => `<button type="button" data-pv="${k}" class="${k === POOLVOL ? 'on' : ''}">${k === 'all' ? 'All' : k}</button>`).join('')}</span></h2><div class="scroll"><table><thead><tr><th class="l">Pool</th><th>Liquidity now</th><th>Tokens now</th><th>Net deposited</th><th>Position P&amp;L</th><th>Range</th><th title="Volume of the whole pool, all traders">Pool volume ${POOLVOL === 'all' ? 'all time' : PV[POOLVOL]}<div class="muted">all traders</div></th><th>Your swaps</th><th>Your swap volume</th><th>Last action</th></tr></thead><tbody>` +
      (pools.filter(r => r.np > 0 || r.evNet || r.swaps).map(r => { const open = r.np > 0, pnl = r.now - r.net; return `<tr><td class="l"><div class="poolcell"><b>${esc(r.pair)}</b><small><a href="${ex}/address/${r.pool}" target="_blank" rel="noopener">${short(r.pool)}</a></small></div></td><td class="num">${open ? usd(r.now) : '—'}</td><td class="num">${open ? `${tok(r.n0)} ${esc(r.s0)}<div class="muted">${tok(r.n1)} ${esc(r.s1)}</div>` : '—'}</td><td class="num">${open ? usd(r.net) : (r.evNet ? usd(r.evNet) : '—')}</td><td class="num ${open ? cl(pnl) : ''}">${open ? sg(pnl) + (r.net > 0 ? `<div class="muted">${fmt(pnl / r.net * 100, 2)}%</div>` : '') : '—'}</td><td class="num">${esc(r.range || '—')}</td><td class="num">${pv(r.pool)}</td><td class="num">${part ? '—' : r.swaps}</td><td class="num">${part ? '—' : (r.swaps ? usd(r.vol) : '—')}</td><td class="num">${dt(r.last)}</td></tr>`; }).join('') || '<tr><td class="empty" colspan="10">No Metric activity found for this wallet</td></tr>') +
      `</tbody></table></div><p class="note">Liquidity now and the tokens come from the Metric API (open positions only). Pool volume is the volume of the whole pool (all traders) for the period chosen in the Pools header, from the Metric API; swaps and swap volume are yours, counted from the loaded CSV. Position P&amp;L = value now − net deposited, both at today's prices, so it shows what swaps and fees did to the position, not price moves of the tokens. Metric's own “Edge” is not available through the API.</p></section>
      <section class="card w12"><h2>Swap history<span class="sub">${part ? '' : fmt(swapHist.length, 0) + ' swaps, ' + periodText() + ', newest first'}</span></h2>${part ? hold : `<div class="scroll tall"><table><thead><tr><th class="l">Time (UTC)</th><th class="l">Pool</th><th class="l">Swapped</th><th>USD</th><th>Tx</th></tr></thead><tbody>` +
      (swapHist.map(e => `<tr><td class="l num">${dt(e.time)}</td><td class="l">${esc(e.pair)} <small class="muted">${short(e.pool)}</small></td><td class="l">${desc(e)}</td><td class="num">${usd(e.usd)}</td><td>${link(short(e.tx), e.tx)}</td></tr>`).join('') || '<tr><td class="empty" colspan="5">No swaps in these transactions</td></tr>') +
      `</tbody></table></div>${note.length ? `<p class="note">${note.join(' ')}</p>` : ''}<p class="note">Swap USD = average of the two sides of the swap at today's prices. Failed transactions are not counted.</p>`}</section>`;
  }

  /* ---------- inputs */
  const closeHowto = () => { const d = $('#howto'); if (d) d.open = false; };
  function hashesIn(text) { return [...new Set((text.match(/0x[0-9a-fA-F]{64}/g) || []).map(h => h.toLowerCase()))]; }
  function guessWallet(text, name) {
    const m = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.exec(name || ''); if (m) return m[0].toLowerCase();
    const cnt = {}; (text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) || []).forEach(a => { a = a.toLowerCase(); cnt[a] = (cnt[a] || 0) + 1; });
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
  }
  async function fromText(text, name) {
    const hs = hashesIn(text); if (!hs.length) { setStatus('No transaction hashes found in this file.', 'err'); return; }
    let w = $('#addr').value.trim().toLowerCase(); if (!isAddr(w)) { w = guessWallet(text, name); if (!w) { setStatus('Enter the wallet address first.', 'err'); return; } $('#addr').value = w; }
    await guard(() => fromHashes(hs, w.toLowerCase(), 'explorer list'));
  }
  async function guard(fn) { try { await fn(); } catch (e) { setStatus('Error: ' + esc(e.message), 'err'); } }
  const readFile = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsText(f); });

  function init() {
    $('#chain').innerHTML = [4663, 1, 56].map(id => `<option value="${id}">${CHAINS[id].name}</option>`).join('');
    $('#chain').onchange = chainChanged; chainChanged();
    $('#rpcUrl').onchange = () => store.set('rpc_' + chainId(), $('#rpcUrl').value.trim());
    $('#form').onsubmit = e => { e.preventDefault(); const w = $('#addr').value.trim().toLowerCase(); if (!isAddr(w)) { setStatus('Enter a wallet address: 0x followed by 40 hex characters.', 'err'); return; } history.replaceState(null, '', '#' + w); guard(() => showPositions(w)); };
    $('#btnCsv').onclick = () => $('#csvFile').click();
    $('#csvFile').onchange = async e => { const f = e.target.files[0]; if (f) guard(async () => fromText(await readFile(f), f.name)); e.target.value = ''; };
    $('#recent').onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; $('#addr').value = b.dataset.a; const h = store.get('hashes_' + chainId() + '_' + b.dataset.a, null); if (h) guard(() => fromHashes(h, b.dataset.a, 'saved list')); };
    $('#btnTheme').onclick = () => { const r = document.documentElement, dark = r.getAttribute('data-theme') !== 'light'; r.setAttribute('data-theme', dark ? 'light' : 'dark'); };
    let dragN = 0;
    addEventListener('dragenter', e => { e.preventDefault(); dragN++; document.body.classList.add('dragging'); });
    addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); } });
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('drop', e => { e.preventDefault(); dragN = 0; document.body.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) guard(async () => fromText(await readFile(f), f.name)); });
    loadPlatform();
    $('#out').addEventListener('click', e => { const b = e.target.closest('[data-pv]'); if (!b) return; POOLVOL = b.dataset.pv; store.set('poolvol', POOLVOL); if (CUR) render(); });
    renderPeriodbar();
    $('#periodbar').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; PERIOD = b.dataset.p; store.set('period', PERIOD); renderPeriodbar(); if (CUR) render(); };
    renderRecent();
    const h = location.hash.slice(1);
    if (isAddr(h.slice(0, 42))) { const w = h.slice(0, 42).toLowerCase(); $('#addr').value = w; const sv = store.get('hashes_' + chainId() + '_' + w, null); if (sv) guard(() => fromHashes(sv, w, 'saved list')); else guard(() => showPositions(w)); }
  }
  init();
})();
