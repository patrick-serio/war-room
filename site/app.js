(() => {
  'use strict';
  const FF = window.FF;
  const app = document.getElementById('app');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + f1(Math.abs(n));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('warroom:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('warroom:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const TABS = [
    { id: 'roster', label: 'Roster', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>' },
    { id: 'lineup', label: 'Lineup', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.5"/>' },
    { id: 'waivers', label: 'Waivers', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>' },
    { id: 'trades', label: 'Trades', icon: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>' },
    { id: 'alerts', label: 'Alerts', icon: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0"/>' },
  ];
  const ESPN_PLACEHOLDERS = [
    { name: 'Belichicks Receivers', meta: 'ESPN · 12 teams' },
    { name: 'Your second ESPN league', meta: 'ESPN' },
  ];

  const hashTab = (location.hash || '').replace('#', '');
  const state = {
    live: null, demo: null, mode: 'live', error: null, sheet: false, sheetMsg: '',
    leagueId: store.get('league', null),
    tab: TABS.some((t) => t.id === hashTab) ? hashTab : store.get('tab', 'roster'),
    wpos: store.get('wpos', ['RB', 'WR', 'TE']),
    tmode: 'scan', tpos: 'WR', tmax: 2,
    glossary: false, matchupOpen: false,
  };
  const ctxs = new Map();
  const memo = new Map();

  const PREVIEW = window.__PREVIEW__ || null; // set only in the single-file preview build
  async function loadJSON(url) {
    if (PREVIEW && url.indexOf('data/demo.json') === 0) return PREVIEW;
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
    return r.json();
  }

  const cur = () => (state.mode === 'demo' ? state.demo : state.live);
  function currentLeague() {
    const D = cur();
    if (!D || !D.leagues.length) return null;
    return D.leagues.find((l) => l.id === state.leagueId) || D.leagues[0];
  }
  function ctxFor(D, lg) {
    const k = state.mode + ':' + lg.id;
    if (!ctxs.has(k)) ctxs.set(k, FF.makeCtx(D, lg));
    return ctxs.get(k);
  }
  function once(key, fn) {
    const k = state.mode + ':' + key;
    if (!memo.has(k)) memo.set(k, fn());
    return memo.get(k);
  }

  const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;
  function ago(iso) {
    const h = hoursSince(iso);
    if (!isFinite(h)) return '';
    if (h < 1) return 'just now';
    if (h < 24) return Math.round(h) + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  // ---------- small components ----------
  function injBadge(inj) {
    if (!inj) return '';
    if (inj === 'Questionable') return '<span class="inj q">Q</span>';
    if (inj === 'Doubtful') return '<span class="inj o">D</span>';
    return `<span class="inj o">${esc(inj === 'IR' ? 'IR' : inj.slice(0, 3).toUpperCase())}</span>`;
  }

  function playerRow(ctx, pid, o) {
    o = o || {};
    const P = ctx.players[pid];
    if (!P) return `<div class="prow"><span class="slot"></span><div class="pmain"><div class="pname"><span class="t">Unknown player ${esc(pid)}</span></div></div><div class="pnum"></div></div>`;
    const eff = FF.effOf(ctx, pid);
    const noProj = ctx.hasProj && !P.p && P.pos !== 'DEF';
    const meta = [P.tm || 'FA', P.opp ? 'Opp ' + P.opp : (noProj ? 'Bye or inactive' : ''), P.age ? P.age + 'y' : ''].filter(Boolean).join(' · ');
    const lead = o.slot ? `<span class="slot">${esc(o.slot.replace('SUPER_FLEX', 'SFLX').replace('WRRB_FLEX', 'W/R').replace('REC_FLEX', 'W/T'))}</span>` : `<span class="lead"><span class="pos pos-${P.pos}">${P.pos}</span></span>`;
    const num = noProj || eff === 0 ? '<b class="dim">–</b>' : `<b>${f1(eff)}</b>`;
    const showVal = ctx.dyn && o.value !== false && P.pos !== 'K' && P.pos !== 'DEF';
    const under = showVal ? `<small><span class="val">Value ${Math.round(FF.valueOf(ctx, pid))}</span></small>` : '<small>proj</small>';
    const posTag = o.slot ? `<span class="pos pos-${P.pos}">${P.pos}</span>` : '';
    return `<div class="prow">${lead}<div class="pmain"><div class="pname">${posTag}<span class="t">${esc(P.n)}</span>${injBadge(P.inj)}</div><div class="pmeta">${esc(o.sub || meta)}</div></div><div class="pnum">${num}${under}</div></div>`;
  }

  function emptyRow(slot) {
    return `<div class="prow"><span class="slot">${esc(slot)}</span><div class="pmain"><div class="pname dim"><span class="t">Empty slot</span></div></div><div class="pnum"></div></div>`;
  }

  const sectionH = (title, n) => `<h2>${esc(title)}${n != null ? `<span class="n">${esc(n)}</span>` : ''}</h2>`;
  const nm = (ctx, pid) => (ctx.players[pid] ? ctx.players[pid].n : pid);

  // ---------- views ----------
  function viewRoster(ctx) {
    const lg = ctx.lg;
    const me = FF.myTeam(ctx);
    const m = FF.matchup(ctx);
    let out = '';
    if (m) {
      const cls = Math.abs(m.margin) < 6 ? '' : (m.margin > 0 ? 'fav' : 'dog');
      const txt = Math.abs(m.margin) < 6 ? 'Toss-up' : (m.margin > 0 ? `Favored by ${f1(m.margin)}` : `Underdog by ${f1(-m.margin)}`);
      out += `<section>${sectionH('This week')}<div class="card match">
        <div class="side"><div class="tn">${esc(me.name)}</div><div class="pts">${f1(m.me)}</div></div><div class="vs">VS</div>
        <div class="side"><div class="tn">${esc(m.oppTeam.name)}</div><div class="pts">${f1(m.opp)}</div></div>
        <div class="foot"><span>Projected with your current lineup</span><span class="${cls}">${txt}</span></div></div>
        <button class="btn" data-act="matchup" style="width:100%;margin-top:8px">See both starting lineups</button></section>`;
    }
    const cl = FF.currentLineup(ctx);
    out += `<section>${sectionH('Starters', f1(cl.total) + ' proj')}<div class="card list">${cl.slots.map((r) => (r.pid ? playerRow(ctx, r.pid, { slot: r.slot }) : emptyRow(r.slot))).join('')}</div></section>`;
    const bench = FF.benchOf(me).sort((a, b) => FF.effOf(ctx, b) - FF.effOf(ctx, a));
    out += `<section>${sectionH('Bench', bench.length)}<div class="card list">${bench.map((p) => playerRow(ctx, p)).join('') || '<div class="prow"><span class="hint">Nobody on the bench.</span></div>'}</div></section>`;
    if ((me.reserve || []).length) out += `<section>${sectionH('Injured reserve', me.reserve.length)}<div class="card list">${me.reserve.map((p) => playerRow(ctx, p)).join('')}</div></section>`;
    if ((me.taxi || []).length) out += `<section>${sectionH('Taxi squad', me.taxi.length)}<div class="card list">${me.taxi.map((p) => playerRow(ctx, p)).join('')}</div></section>`;
    if ((me.picks || []).length) {
      const season = ctx.D.season;
      out += `<section>${sectionH('Draft picks', me.picks.length)}<div class="card list">${me.picks.map((pk) => {
        const from = pk.from !== me.roster_id ? `from ${esc((FF.teamOf(lg, pk.from) || {}).name || 'another team')}` : 'your own';
        return `<div class="prow"><span class="slot">R${pk.rd}</span><div class="pmain"><div class="pname"><span class="t">${esc(pk.s)} round ${pk.rd}</span></div><div class="pmeta">${from}</div></div><div class="pnum"><span class="val">Value ${Math.round(FF.pickValue(pk, season))}</span></div></div>`;
      }).join('')}</div></section>`;
    }
    return out;
  }

  function viewLineup(ctx) {
    const adv = FF.lineupAdvice(ctx);
    let out = '';
    if (adv.gain >= 0.3 || adv.emptyCur) {
      out += `<div class="card banner good"><div class="big">Best lineup adds <em>${signed(adv.gain)}</em> pts</div><div class="hint">${f1(adv.current.total)} now, ${f1(adv.optimal.total)} with the moves below.</div></div>`;
    } else {
      out += `<div class="card banner"><div class="big">Your lineup is already the best one</div><div class="hint">${f1(adv.current.total)} projected. Nothing on your bench beats a starter.</div></div>`;
    }
    if (adv.swaps.length) {
      out += `<section>${sectionH('Make these moves')}${adv.swaps.map((s) => `
        <div class="card act"><div class="act-h"><div class="ttl">${s.out ? 'Swap' : 'Fill an empty slot'}</div><div class="gain">${signed(s.gain)}</div></div>
          <div class="pair"><div class="row"><span class="tag in">Start</span>${miniPlayer(ctx, s.in)}</div>${s.out ? `<div class="row"><span class="tag out">Sit</span>${miniPlayer(ctx, s.out)}</div>` : ''}</div>
          ${reasonList(ctx, s.insights)}</div>`).join('')}</section>`;
    }
    if (adv.close.length) {
      out += `<section>${sectionH('Toss-ups', 'close calls')}${adv.close.map((c) => `
        <div class="card act"><div class="act-h"><div class="ttl">${esc(nm(ctx, c.a))} or ${esc(nm(ctx, c.b))}</div><span class="hint">${f1(c.diff)} apart</span></div>
          <div class="pair"><div class="row"><span class="tag ${c.verdict.flipped ? 'out' : 'in'}">${c.verdict.flipped ? 'Lean' : 'Start'}</span>${miniPlayer(ctx, c.verdict.lean)}</div></div>
          ${c.verdict.reasons.length ? reasonList(ctx, c.verdict.reasons) : '<p class="hint">No usage or form edge either way. Go with the higher projection.</p>'}</div>`).join('')}</section>`;
    }
    out += `<section>${sectionH('Full best lineup', f1(adv.optimal.total))}<div class="card list">${adv.optimal.slots.map((r) => (r.pid ? playerRow(ctx, r.pid, { slot: r.slot }) : emptyRow(r.slot))).join('')}</div>
      <p class="hint">Points are Sleeper's own weekly projection, discounted for injury status. Bye weeks and Out players count as zero. Recent-form and usage trends are called out separately on toss-ups and swaps above.</p></section>`;
    return out;
  }

  function miniPlayer(ctx, pid) {
    const P = ctx.players[pid];
    if (!P) return `<span>${esc(pid)}</span>`;
    return `<span class="pos pos-${P.pos}">${P.pos}</span><span class="pname"><span class="t">${esc(P.n)}</span>${injBadge(P.inj)}</span><span class="hint" style="margin-left:auto">${f1(FF.effOf(ctx, pid))}</span>`;
  }
  function reasonList(ctx, items) {
    if (!items || !items.length) return '';
    return `<ul class="reasons">${items.map((r) => `<li><b>${esc(nm(ctx, r.pid))}:</b> ${esc(r.t)}</li>`).join('')}</ul>`;
  }

  function viewWaivers(ctx) {
    const all = ['RB', 'WR', 'TE', 'QB', 'K', 'DEF'];
    let out = `<section><div class="ctl"><span class="label">Positions</span><div class="chips">${all.map((p) => `<button class="tog" data-act="wpos" data-pos="${p}" aria-pressed="${state.wpos.includes(p)}">${p}</button>`).join('')}</div></div></section>`;
    if (!(ctx.lg.free_agents || []).length) return out + '<div class="card empty"><h3>No free agents loaded</h3><p class="hint">The last refresh did not include a waiver pool for this league.</p></div>';
    const w = once('w:' + ctx.lg.id + ':' + state.wpos.join(), () => FF.waivers(ctx, { positions: state.wpos }));
    const wrow = (r, showGain) => `<div class="card act">${playerRow(ctx, r.pid, { value: false }).replace('class="prow"', 'class="prow" style="padding:0;min-height:0"')}
      ${showGain ? `<div class="stats"><span>Lineup <b>${signed(r.gain)}</b> pts a week</span>${r.trending ? '<span>Trending up</span>' : ''}</div>` : (r.trending ? '<div class="stats"><span>Trending up</span></div>' : '')}
      ${w.openSpots > 0 ? '<p class="hint">You have an open roster spot, so no drop needed.</p>' : (r.drop && (r.gain >= 0.5 || r.candValue > r.dropValue) ? `<div class="pair"><div class="row"><span class="tag out">Drop</span>${miniPlayer(ctx, r.drop)}</div></div>` : '')}
      ${r.facts.length ? `<ul class="reasons">${r.facts.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
    if (w.upgrades.length) out += `<section>${sectionH('Lineup upgrades', 'would start for you')}${w.upgrades.map((r) => wrow(r, true)).join('')}</section>`;
    else out += '<div class="card banner"><div class="big">No pickup beats your starters</div><div class="hint">Nobody available would crack your lineup this week.</div></div>';
    if (w.thin.length) out += `<section>${sectionH('Thin spots', 'bench depth: ' + w.thin.join(', '))}${w.byNeed.map((r) => wrow(r, false)).join('')}</section>`;
    if (w.trending.length) out += `<section>${sectionH('Trending adds')}${w.trending.map((r) => wrow(r, true)).join('')}</section>`;
    if (w.stash.length) out += `<section>${sectionH('Dynasty stashes', 'young with upside')}${w.stash.map((r) => wrow(r, false)).join('')}</section>`;
    if (!w.upgrades.length && !w.trending.length) out += `<section>${sectionH('Best available')}${w.best.map((r) => wrow(r, false)).join('')}</section>`;
    return out;
  }

  function offerText(ctx, o) {
    const give = o.give.map((g) => (g.type === 'pick' ? `my ${g.pk.s} round ${g.pk.rd} pick` : nm(ctx, g.pid))).join(' + ');
    return `Would you do ${give} for ${nm(ctx, o.get)}?`;
  }

  function viewTrades(ctx) {
    let out = `<div class="seg" role="group" aria-label="Trade mode"><button data-act="tmode" data-m="scan" aria-pressed="${state.tmode === 'scan'}">Scan the league</button><button data-act="tmode" data-m="target" aria-pressed="${state.tmode === 'target'}">Target a position</button></div>`;
    const rep = once('rep:' + ctx.lg.id, () => FF.positionReport(ctx));
    if (state.tmode === 'scan') {
      out += `<section>${sectionH('Your roster')}<div class="rep">${rep.map((r) => `<div class="card"><span class="pos pos-${r.pos}" style="align-self:flex-start">${r.pos}</span><span class="st ${r.status}">${r.status === 'need' ? 'Need help' : r.status === 'surplus' ? 'Surplus' : 'Balanced'}</span><span class="sub">${r.status === 'surplus' ? esc(r.surplus.map((p) => nm(ctx, p)).join(', ')) : `Weakest starter ${f1(r.weakest)} vs league median ${f1(r.median)}`}</span></div>`).join('')}</div></section>`;
    } else {
      out += `<section><div class="ctl"><span class="label">Who do you want?</span><div class="chips">${['QB', 'RB', 'WR', 'TE'].map((p) => `<button class="tog" data-act="tpos" data-pos="${p}" aria-pressed="${state.tpos === p}">${p}</button>`).join('')}</div></div>
        <div class="ctl"><span class="label">Most players you'll give</span><div class="chips">${[1, 2, 3].map((n) => `<button class="tog" data-act="tmax" data-n="${n}" aria-pressed="${state.tmax === n}">${n}</button>`).join('')}</div></div></section>`;
    }
    const opts = state.tmode === 'scan' ? { maxGive: 3, limit: 8 } : { maxGive: state.tmax, pos: state.tpos, limit: 8 };
    const offers = once('t:' + ctx.lg.id + ':' + state.tmode + state.tpos + state.tmax, () => FF.tradeOffers(ctx, opts));
    state.offers = offers;
    if (!offers.length) return out + '<div class="card empty"><h3>No fair offers found</h3><p class="hint">Nothing balanced and useful to both sides came up. Try another position or allow more players in the package.</p></div>';
    out += `<section>${sectionH('Offers worth sending', offers.length)}${offers.map((o, i) => `
      <article class="card offer"><div class="offer-h"><span class="ttl">${esc(o.opp.name)}</span><span class="tier">${esc(o.tier)}</span></div>
      <div class="xfer">${o.give.map((g) => (g.type === 'pick'
        ? `<div class="row"><span class="tag out">Give</span><span class="nm">${esc(g.pk.s)} round ${g.pk.rd} pick</span><span class="v">Value ${Math.round(g.v)}</span></div>`
        : `<div class="row"><span class="tag out">Give</span><span class="nm">${esc(nm(ctx, g.pid))}</span><span class="v">${ctx.players[g.pid].pos}${ctx.dyn ? ' · V' + Math.round(g.v) : ''}</span></div>`)).join('')}
        <div class="row"><span class="tag in">Get</span><span class="nm">${esc(nm(ctx, o.get))}</span><span class="v">${ctx.players[o.get].pos}${ctx.dyn ? ' · V' + Math.round(o.vGet) : ''}</span></div></div>
      <div class="stats"><span>You <b>${signed(o.dMe)}</b> pts a week</span><span>Them <b>${signed(o.dThem)}</b></span>${ctx.dyn ? `<span>Value <b>${Math.round(o.vGive)}</b> for <b>${Math.round(o.vGet)}</b></span>` : ''}</div>
      ${o.why.length ? `<ul class="reasons">${o.why.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <button class="btn" data-act="copy" data-i="${i}">Copy offer message</button></article>`).join('')}</section>
      <p class="hint">Offers only include trades that help both lineups, with at most one player per position on your side.</p>`;
    return out;
  }

  function viewAlerts(ctx, D) {
    const al = once('a:' + ctx.lg.id, () => FF.buildAlerts(ctx));
    let out = '';
    if (!al.length) out += '<div class="card banner good"><div class="big">All clear</div><div class="hint">No injuries, byes or lineup moves need attention.</div></div>';
    else out += `<section>${sectionH('This week', al.length)}${al.map((a) => `<button class="alert" data-act="goto" data-tab="${a.tab}"><span class="sev ${a.sev}">${a.sev === 'now' ? 'Now' : a.sev === 'soon' ? 'Soon' : 'FYI'}</span><span><div class="ttl">${esc(a.title)}</div><div class="bd">${esc(a.body)}</div></span></button>`).join('')}</section>`;
    const notes = (D.notes || []).slice();
    if (state.mode !== 'demo' && hoursSince(D.generated_at) > 30) notes.unshift(`Data is ${ago(D.generated_at)} old. The scheduled refresh may have failed.`);
    if (notes.length) out += `<section>${sectionH('Data notes')}<div class="notes">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div></section>`;
    out += state.mode === 'demo' ? '<p class="hint">Sample data with fictional players. Alerts show when you open the app.</p>' : `<p class="hint">Alerts show when you open the app. Refreshed ${esc(ago(D.generated_at))}, week ${esc(D.week)}.</p>`;
    return out;
  }

  // ---------- chrome ----------
  function header(D, lg) {
    const fmt = { dynasty: 'Dynasty', keeper: 'Keeper', redraft: 'Redraft' }[lg && lg.format] || '';
    const sc = { ppr: 'PPR', half: 'Half PPR', std: 'Standard' }[lg && lg.scoring] || '';
    const stale = D && state.mode !== 'demo' && hoursSince(D.generated_at) > 30;
    return `<header class="top"><div class="wrap"><div class="brand">War Room</div>
      <button class="icon-btn" data-act="glossary" aria-haspopup="dialog" aria-label="What these numbers mean" title="What these numbers mean">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.4 9.2a2.6 2.6 0 1 1 3.6 2.4c-1 .4-1.6 1.1-1.6 2.3"/><path d="M12 17.3h.01"/></svg>
      </button>
      ${lg ? `<button class="lg-btn" data-act="sheet" aria-haspopup="dialog"><span class="nm">${esc(lg.name)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>` : `<button class="lg-btn" data-act="sheet"><span class="nm">Leagues</span></button>`}</div>
      ${lg ? `<div class="wrap subbar">${state.mode === 'demo' ? '<span class="chip demo">Demo, fictional players</span>' : ''}<span class="chip">${esc(fmt)}</span><span class="chip">${esc(sc)}</span><span class="chip">Week ${esc(D.week)}</span>${state.mode === 'demo' ? '' : `<span class="${stale ? 'stale' : ''}">Updated ${esc(ago(D.generated_at))}</span>`}</div>` : ''}</header>`;
  }

  function nav(alertCount) {
    return `<nav class="tabs" aria-label="Sections"><div class="wrap">${TABS.map((t) => `<button data-act="tab" data-tab="${t.id}" ${state.tab === t.id ? 'aria-current="page"' : ''}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg><span>${t.label}</span>
      ${t.id === 'alerts' && alertCount ? `<span class="badge">${alertCount}</span>` : ''}</button>`).join('')}</div></nav>`;
  }

  function sheet() {
    const D = cur();
    const opt = (l) => `<button class="lg-opt" data-act="league" data-id="${esc(l.id)}" ${l.id === (currentLeague() || {}).id ? 'aria-current="true"' : ''}><span class="n1">${esc(l.name)}</span><span class="n2">${{ dynasty: 'Dynasty', keeper: 'Keeper', redraft: 'Redraft' }[l.format]} · ${{ ppr: 'PPR', half: 'Half PPR', std: 'Standard' }[l.scoring]} · ${l.teams.length} teams · ${l.platform === 'espn' ? 'ESPN' : 'Sleeper'}</span></button>`;
    let rows = D ? D.leagues.map(opt).join('<div style="height:1px;background:var(--line)"></div>') : '';
    if (state.mode === 'live' && !(D && D.leagues.some((l) => l.platform === 'espn'))) {
      rows += ESPN_PLACEHOLDERS.map((e) => `<div style="height:1px;background:var(--line)"></div><button class="lg-opt" disabled><span class="n1">${esc(e.name)}</span><span class="n2">${esc(e.meta)} · not connected yet</span></button>`).join('');
    }
    return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-label="Choose league"><div class="wrap"><h3>Your leagues</h3><div class="card" style="overflow:hidden">${rows}</div>
      <div style="height:12px"></div>${PREVIEW ? '<p class="hint">This preview only has the fictional demo league. Your real leagues appear once the data refresh is connected.</p>' : (state.mode === 'live' ? '<button class="btn" data-act="demo" style="width:100%">Look around the demo league</button>' : '<button class="btn primary" data-act="live" style="width:100%">Back to my leagues</button>')}
      ${state.sheetMsg ? `<p class="hint" style="padding-top:8px">${esc(state.sheetMsg)}</p>` : ''}</div></div>`;
  }

  const GLOSSARY = [
    ['Every screen', [
      ['Proj', "Sleeper's own projected fantasy points for that player this week, in your league's scoring format. Counted as 0 if he's Out, IR, Suspended or on a bye; cut about 40% if Doubtful and 7% if Questionable."],
      ['Value', "Redraft leagues: value over replacement, how many points better this player is than a readily available replacement at his position, scaled up so a difference-making starter reads far higher than a bench stash. Dynasty or keeper leagues: blends that same value-over-replacement with the player's overall rank and an age curve, so a young, highly-ranked player scores above a same-production veteran."],
    ]],
    ['Lineup tab', [
      ['Gain (a swap)', "The extra points per week starting the suggested player over the one he replaces is worth -- just the difference between their Proj numbers."],
      ['Toss-up', "Two options within 1.5 points of Proj. Since the raw projection can't call something that close, the lean shown underneath factors in recent-game scoring and target or touch trends -- listed as the reasons below it."],
    ]],
    ['Waivers tab', [
      ['Lineup +X pts a week', "How much adding this free agent would improve your best possible lineup's weekly total, compared to your best lineup without him."],
      ['Trending', "Added by a lot of Sleeper managers, across all of Sleeper, in the last 48 hours."],
      ['Drop', "The weakest bench player you could spare at any position, without leaving you short a kicker, DEF, TE, or (in Superflex leagues) a backup QB."],
    ]],
    ['Trades tab', [
      ['Need / Balanced / Surplus', "Compares your weakest starter at a position to the median team's weakest starter there. \"Need\" means you're below that bar; \"Surplus\" means even your bench beats it."],
      ['Value X for Y', "The same Value numbers from each side of a trade, added up, so you can eyeball whether a package is roughly fair (dynasty and keeper leagues only)."],
      ['You / Them +X pts a week', "How much the trade would move each side's best-lineup total, assuming both sides then start their best lineup."],
    ]],
  ];
  function glossary() {
    const body = GLOSSARY.map(([h, rows]) => `<h4>${esc(h)}</h4><dl class="gloss">${rows.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`).join('');
    return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-label="What these numbers mean"><div class="wrap"><h3>What these numbers mean</h3>${body}
      <div style="height:4px"></div><p class="hint">Sleeper only for now; ESPN support is planned. Data refreshes automatically every few hours.</p></div></div>`;
  }

  function matchupSheet(ctx) {
    const m = FF.matchup(ctx);
    if (!m) return '';
    const me = FF.myTeam(ctx);
    const side = (team, lineup) => `<h4>${esc(team.name)}<span style="float:right;color:var(--ink)">${f1(lineup.total)}</span></h4>
      <div class="card list">${lineup.slots.map((r) => (r.pid ? playerRow(ctx, r.pid, { slot: r.slot }) : emptyRow(r.slot))).join('')}</div>`;
    return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-label="This week's matchup"><div class="wrap"><h3>This week's matchup</h3>
      ${side(me, FF.currentLineup(ctx, me))}
      <div style="height:14px"></div>
      ${side(m.oppTeam, FF.currentLineup(ctx, m.oppTeam))}
      <div style="height:4px"></div><p class="hint">Both sides are each team's actual starters as currently set in Sleeper (not the optimal lineup), with the same Proj numbers used everywhere else. If a total looks wrong, check here for a starter with no Proj (bye or inactive, shown as "–"), an unexpected injury discount, or a player who shouldn't be starting.</p></div></div>`;
  }

  function render() {
    const D = cur();
    const lg = currentLeague();
    let body;
    let alertCount = 0;
    if (!D || !lg) {
      const msg = state.error ? `Could not load your league data. ${esc(state.error)}` : (D ? 'No leagues found for this Sleeper account this season.' : 'Loading…');
      body = `<div class="card empty"><h3>${state.error || (D && !lg) ? 'No league data yet' : 'Loading'}</h3><p class="hint">${msg}</p>${state.error || (D && !lg) ? '<p class="hint">The first scheduled refresh may not have run. You can still look around the demo league.</p><button class="btn primary" data-act="demo">Open the demo league</button>' : ''}</div>`;
      app.innerHTML = `${header(D, null)}<main class="wrap">${body}</main>${state.sheet ? sheet() : ''}${state.glossary ? glossary() : ''}`;
      return;
    }
    const ctx = ctxFor(D, lg);
    try {
      alertCount = once('a:' + lg.id, () => FF.buildAlerts(ctx)).filter((a) => a.sev !== 'info').length;
      body = { roster: viewRoster, lineup: viewLineup, waivers: viewWaivers, trades: viewTrades, alerts: viewAlerts }[state.tab](ctx, D);
    } catch (e) {
      console.error(e);
      body = `<div class="card empty"><h3>Something went wrong</h3><p class="hint">${esc(e.message)}</p></div>`;
    }
    app.innerHTML = `${header(D, lg)}<main class="wrap">${body}</main>${nav(alertCount)}${state.sheet ? sheet() : ''}${state.glossary ? glossary() : ''}${state.matchupOpen ? matchupSheet(ctx) : ''}`;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  app.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act === 'tab' || act === 'goto') {
      state.tab = el.dataset.tab; store.set('tab', state.tab);
      try { history.replaceState(null, '', '#' + state.tab); } catch (err) { /* ignore */ }
      render(); window.scrollTo(0, 0);
    } else if (act === 'sheet') { state.sheet = true; state.sheetMsg = ''; render(); }
    else if (act === 'glossary') { state.glossary = true; render(); }
    else if (act === 'matchup') { state.matchupOpen = true; render(); }
    else if (act === 'close') { state.sheet = false; state.glossary = false; state.matchupOpen = false; render(); }
    else if (act === 'league') { state.leagueId = el.dataset.id; if (state.mode === 'live') store.set('league', state.leagueId); state.sheet = false; render(); window.scrollTo(0, 0); }
    else if (act === 'wpos') {
      const p = el.dataset.pos;
      state.wpos = state.wpos.includes(p) ? state.wpos.filter((x) => x !== p) : [...state.wpos, p];
      if (!state.wpos.length) state.wpos = [p];
      store.set('wpos', state.wpos); render();
    } else if (act === 'tmode') { state.tmode = el.dataset.m; render(); }
    else if (act === 'tpos') { state.tpos = el.dataset.pos; render(); }
    else if (act === 'tmax') { state.tmax = Number(el.dataset.n); render(); }
    else if (act === 'copy') {
      const o = (state.offers || [])[Number(el.dataset.i)];
      if (!o) return;
      const ok = await copyText(offerText(cur() && ctxFor(cur(), currentLeague()), o));
      el.textContent = ok ? 'Copied' : 'Copy failed. Select the names above instead.';
      setTimeout(() => { el.textContent = 'Copy offer message'; }, 1800);
    } else if (act === 'demo') {
      try {
        if (!state.demo) state.demo = await loadJSON('data/demo.json');
        state.mode = 'demo'; state.leagueId = null; state.sheet = false; state.sheetMsg = '';
      } catch (err) { state.sheetMsg = 'The demo data could not be loaded.'; }
      render(); window.scrollTo(0, 0);
    } else if (act === 'live') {
      state.mode = 'live'; state.leagueId = store.get('league', null); state.sheet = false; render(); window.scrollTo(0, 0);
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (state.sheet || state.glossary || state.matchupOpen)) { state.sheet = false; state.glossary = false; state.matchupOpen = false; render(); } });

  (async function init() {
    if (PREVIEW) { state.demo = PREVIEW; state.mode = 'demo'; state.live = null; render(); return; }
    render();
    try { state.live = await loadJSON('data/leagues.json'); } catch (e) { state.error = e.message; }
    render();
  })();
})();
