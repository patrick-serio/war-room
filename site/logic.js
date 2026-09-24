/* Fantasy HQ analytics. Pure functions: no DOM, runs in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ELIG = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
    FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  };
  const SLOT_RANK = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5, WRRB_FLEX: 10, REC_FLEX: 11, FLEX: 12, SUPER_FLEX: 13 };
  const OUT_STATUS = ['Out', 'IR', 'PUP', 'Sus', 'COV', 'NA'];
  const TRADE_POS = ['QB', 'RB', 'WR', 'TE'];
  const PICK_VALUE = { 1: 45, 2: 24, 3: 13, 4: 7, 5: 4 };

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const r1 = (x) => Math.round(x * 10) / 10;

  function injFactor(inj) {
    if (!inj) return 1;
    if (OUT_STATUS.includes(inj)) return 0;
    if (inj === 'Doubtful') return 0.4;
    if (inj === 'Questionable') return 0.93;
    return 1;
  }

  // Score a player's raw projected/actual stat line against the league's own
  // scoring_settings (per-stat point values), the same way Sleeper's app does.
  // Sleeper's public projections endpoint also exposes canned std/half/ppr point
  // totals, but those assume generic default scoring and drift from what a league
  // with any custom weight (yardage bonuses, a heavier INT penalty, etc) actually
  // awards -- computing it ourselves from the raw stats matches Sleeper's own
  // number exactly instead.
  function scoreOf(stats, scoringSettings) {
    if (!stats || !scoringSettings) return 0;
    let t = 0;
    for (const k in scoringSettings) {
      const w = scoringSettings[k];
      if (typeof w === 'number' && stats[k]) t += stats[k] * w;
    }
    return t;
  }

  function form(ctx, P) {
    const r = (P && P.r) || [];
    const v = r.slice(-3).map((st) => scoreOf(st, ctx.lg.scoring_settings));
    return v.length ? mean(v) : null;
  }

  function makeCtx(D, lg) {
    const players = D.players;
    const hasProj = Object.values(players).some((p) => p.p);
    return { D, lg, players, hasProj, dyn: lg.format !== 'redraft', cache: new Map(), pcache: new Map(), vcache: new Map(), _repl: null };
  }

  // The headline number is Sleeper's own projection, full stop -- not blended
  // with recent form, not discounted for injury status. Recent-form trends
  // surface separately as reasoning on close calls and swaps (see facts()/
  // verdict() below); the injury discount is exposed as a sub-value by the UI
  // (see effOf below) instead of silently moving the main number.
  function projOf(ctx, pid) {
    if (ctx.pcache.has(pid)) return ctx.pcache.get(pid);
    const P = ctx.players[pid];
    let v = 0;
    if (P) {
      const pj = P.p ? scoreOf(P.p, ctx.lg.scoring_settings) : null;
      const fm = form(ctx, P);
      v = pj != null ? pj : (!ctx.hasProj && fm != null ? fm : 0);
    }
    ctx.pcache.set(pid, v);
    return v;
  }

  // Risk-adjusted points: projOf() discounted for injury status. Used to decide
  // who to start/recommend/value (an Out player should never get picked as
  // "optimal"), never as the headline number shown for a player.
  function effOf(ctx, pid) {
    if (ctx.cache.has(pid)) return ctx.cache.get(pid);
    const P = ctx.players[pid];
    const v = P ? projOf(ctx, pid) * injFactor(P.inj) : 0;
    ctx.cache.set(pid, v);
    return v;
  }

  // ---------- roster helpers ----------
  const teamOf = (lg, rid) => lg.teams.find((t) => t.roster_id === rid);
  const myTeam = (ctx) => teamOf(ctx.lg, ctx.lg.me);
  function activeOf(team) {
    const off = new Set([...(team.reserve || []), ...(team.taxi || [])]);
    return team.players.filter((p) => !off.has(p));
  }
  function benchOf(team) {
    const st = new Set(team.starters);
    return activeOf(team).filter((p) => !st.has(p));
  }
  const rawSlots = (lg) => lg.slots.filter((s) => s !== 'BN');
  const unknownSlots = (lg) => rawSlots(lg).filter((s) => !ELIG[s]);

  // ---------- lineup ----------
  function optimalLineup(ctx, pids) {
    const slots = rawSlots(ctx.lg).map((s, i) => ({ s, i })).filter((x) => ELIG[x.s]);
    slots.sort((a, b) => SLOT_RANK[a.s] - SLOT_RANK[b.s] || a.i - b.i);
    const pool = pids.filter((p) => ctx.players[p]).sort((a, b) => effOf(ctx, b) - effOf(ctx, a));
    const used = new Set();
    const out = [];
    let total = 0;
    for (const { s, i } of slots) {
      const pid = pool.find((p) => !used.has(p) && ELIG[s].includes(ctx.players[p].pos) && effOf(ctx, p) > 0) || null;
      if (pid) { used.add(pid); total += projOf(ctx, pid); }
      out.push({ slot: s, idx: i, pid });
    }
    out.sort((a, b) => a.idx - b.idx);
    return { slots: out, total };
  }

  function currentLineup(ctx, team) {
    const t = team || myTeam(ctx);
    const slots = rawSlots(ctx.lg);
    const rows = [];
    let total = 0;
    slots.forEach((s, i) => {
      if (!ELIG[s]) return;
      const pid = t.starters[i] && t.starters[i] !== '0' ? t.starters[i] : null;
      if (pid) total += projOf(ctx, pid);
      rows.push({ slot: s, idx: i, pid });
    });
    return { slots: rows, total };
  }

  function lineupAdvice(ctx) {
    const team = myTeam(ctx);
    const cur = currentLineup(ctx, team);
    const opt = optimalLineup(ctx, activeOf(team));
    const curSet = new Set(cur.slots.map((x) => x.pid).filter(Boolean));
    const optSet = new Set(opt.slots.map((x) => x.pid).filter(Boolean));
    const ins = [...optSet].filter((p) => !curSet.has(p)).sort((a, b) => effOf(ctx, b) - effOf(ctx, a));
    const outs = [...curSet].filter((p) => !optSet.has(p)).sort((a, b) => effOf(ctx, a) - effOf(ctx, b));
    const emptyCur = cur.slots.filter((x) => !x.pid).length;
    const swaps = [];
    const pairs = [];
    const insLeft = ins.slice();
    const outsLeft = outs.slice().sort((a, b) => effOf(ctx, b) - effOf(ctx, a));
    for (const inn of ins) {
      const k = outsLeft.findIndex((o) => ctx.players[o].pos === ctx.players[inn].pos);
      if (k >= 0) { pairs.push([inn, outsLeft.splice(k, 1)[0]]); insLeft.splice(insLeft.indexOf(inn), 1); }
    }
    insLeft.forEach((inn) => pairs.push([inn, outsLeft.length ? outsLeft.shift() : null]));
    for (const [inn, out] of pairs) {
      const gain = projOf(ctx, inn) - (out ? projOf(ctx, out) : 0);
      swaps.push({ in: inn, out, gain: r1(gain), insights: out ? compare(ctx, inn, out) : [] });
    }
    swaps.sort((a, b) => b.gain - a.gain);
    return {
      current: cur, optimal: opt, gain: r1(opt.total - cur.total), swaps, emptyCur,
      close: closeCalls(ctx, team, curSet, optSet),
    };
  }

  function closeCalls(ctx, team, curSet, optSet) {
    const bench = benchOf(team);
    const seen = new Set();
    const out = [];
    for (const s of curSet) {
      const sp = ctx.players[s];
      for (const b of bench) {
        const bp = ctx.players[b];
        if (!bp || bp.pos !== sp.pos) continue;
        const d = projOf(ctx, s) - projOf(ctx, b);
        if (Math.abs(d) > 1.5 || effOf(ctx, b) <= 0 || effOf(ctx, s) <= 0) continue;
        const key = [s, b].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const hi = d >= 0 ? s : b;
        const lo = d >= 0 ? b : s;
        out.push({ a: hi, b: lo, diff: r1(Math.abs(d)), verdict: verdict(ctx, hi, lo) });
      }
    }
    out.sort((x, y) => x.diff - y.diff);
    return out.slice(0, 6);
  }

  function trend(list, minDelta) {
    if (!list || list.length < 3) return null;
    const recent = mean(list.slice(-2));
    const prior = mean(list.slice(0, -2));
    const d = recent - prior;
    if (Math.abs(d) < minDelta) return null;
    return { recent: r1(recent), prior: r1(prior), up: d > 0 };
  }

  function facts(ctx, pid) {
    const P = ctx.players[pid];
    const out = [];
    let lean = 0;
    if (!P) return { out, lean };
    const pj = P.p ? scoreOf(P.p, ctx.lg.scoring_settings) : null;
    const fm = form(ctx, P);
    const n = (P.r || []).slice(-3).length;
    if (pj != null && fm != null && n >= 2) {
      if (fm - pj >= 2) { out.push(`Averaging ${fm.toFixed(1)} over his last ${n} games, above the ${pj.toFixed(1)} projection`); lean += 0.5; }
      else if (pj - fm >= 2) { out.push(`Averaging only ${fm.toFixed(1)} over his last ${n} games against a ${pj.toFixed(1)} projection`); lean -= 0.5; }
    }
    const usage = P.pos === 'RB' ? { t: trend(P.tch, 3), what: 'touches' } : (P.pos === 'WR' || P.pos === 'TE') ? { t: trend(P.tgt, 1.5), what: 'targets' } : null;
    if (usage && usage.t) {
      out.push(`${usage.what[0].toUpperCase() + usage.what.slice(1)} ${usage.t.up ? 'up' : 'down'}: ${usage.t.recent} a game lately vs ${usage.t.prior} before`);
      lean += usage.t.up ? 0.7 : -0.7;
    }
    if (P.inj === 'Questionable') { out.push('Listed Questionable'); lean -= 0.3; }
    if (P.inj === 'Doubtful') { out.push('Listed Doubtful'); }
    if (ctx.hasProj && !P.p && P.pos !== 'DEF') out.push('No projection this week (bye or inactive)');
    return { out, lean };
  }

  function compare(ctx, inn, out) {
    return [...facts(ctx, inn).out.map((t) => ({ pid: inn, t })), ...facts(ctx, out).out.map((t) => ({ pid: out, t }))];
  }

  function verdict(ctx, hi, lo) {
    const a = facts(ctx, hi);
    const b = facts(ctx, lo);
    const scoreHi = effOf(ctx, hi) + a.lean;
    const scoreLo = effOf(ctx, lo) + b.lean;
    const lean = scoreLo > scoreHi + 0.2 ? lo : hi;
    return {
      lean,
      flipped: lean !== hi,
      reasons: [...a.out.map((t) => ({ pid: hi, t })), ...b.out.map((t) => ({ pid: lo, t }))],
    };
  }

  // ---------- value ----------
  // Keeper-round discount, same shape as ageMult() -- a ratio, not a flat
  // subtraction. PICK_VALUE (45/24/13/7/4/3) is calibrated for season-long
  // dynasty asset value; subtracting it directly from a single-week vor*5
  // metric put it on the wrong scale and wiped out every early-round
  // keeper's value (the best players, exactly backwards). This keeps a
  // strong performer's value proportionate to his real production at any
  // keeper cost, while still discounting round 1 more than round 15.
  function keeperMult(rd) {
    if (rd == null) return 1;
    if (rd <= 1) return 0.75;
    if (rd === 2) return 0.82;
    if (rd === 3) return 0.88;
    if (rd === 4) return 0.92;
    if (rd === 5) return 0.95;
    return 0.98;
  }

  function ageMult(pos, age) {
    if (age == null) return 1;
    switch (pos) {
      case 'RB': return age <= 22 ? 1.1 : age <= 25 ? 1 : age === 26 ? 0.88 : age === 27 ? 0.72 : age === 28 ? 0.55 : 0.38;
      case 'WR': return age <= 23 ? 1.08 : age <= 27 ? 1 : age === 28 ? 0.9 : age === 29 ? 0.78 : age === 30 ? 0.62 : 0.45;
      case 'TE': return age <= 24 ? 1.05 : age <= 29 ? 1 : age === 30 ? 0.85 : age === 31 ? 0.7 : 0.5;
      case 'QB': return age <= 30 ? 1 : age <= 33 ? 0.9 : age <= 36 ? 0.72 : 0.5;
      default: return 1;
    }
  }

  function replacement(ctx) {
    if (ctx._repl) return ctx._repl;
    const lg = ctx.lg;
    const n = lg.teams.length;
    const slots = rawSlots(lg);
    const ded = (p) => slots.filter((s) => s === p).length;
    const flex = (s) => slots.filter((x) => x === s).length;
    const need = {
      QB: ded('QB') + flex('SUPER_FLEX') * 0.6,
      RB: ded('RB') + flex('FLEX') * 0.4 + flex('SUPER_FLEX') * 0.15 + flex('WRRB_FLEX') * 0.5,
      WR: ded('WR') + flex('FLEX') * 0.45 + flex('SUPER_FLEX') * 0.15 + flex('WRRB_FLEX') * 0.5 + flex('REC_FLEX') * 0.7,
      TE: ded('TE') + flex('FLEX') * 0.15 + flex('SUPER_FLEX') * 0.1 + flex('REC_FLEX') * 0.3,
      K: ded('K'), DEF: ded('DEF'),
    };
    const rostered = new Set(lg.teams.flatMap((t) => activeOf(t)));
    const repl = {};
    for (const pos of Object.keys(need)) {
      const effs = [...rostered].filter((p) => ctx.players[p] && ctx.players[p].pos === pos).map((p) => effOf(ctx, p)).sort((a, b) => b - a);
      const k = Math.max(0, Math.round(n * need[pos]));
      repl[pos] = effs.length ? effs[Math.min(k, effs.length - 1)] : 0;
    }
    ctx._repl = repl;
    return repl;
  }

  function valueOf(ctx, pid) {
    if (ctx.vcache.has(pid)) return ctx.vcache.get(pid);
    const P = ctx.players[pid];
    let v = 0;
    if (P) {
      if (P.pos === 'K' || P.pos === 'DEF') v = 1;
      else {
        const vor = Math.max(0, effOf(ctx, pid) - replacement(ctx)[P.pos]) * 5;
        if (ctx.dyn && P.kprd != null) {
          // Keeper league (ESPN): no age/dynasty-rank data, but the round
          // he'd cost to keep is a good long-term signal -- discount
          // proportionally to his real production, same shape as the
          // age-based branch below. Long-term keeper value shouldn't swing
          // on one noisy week -- but a plain max(projection, recent) is
          // asymmetric (a huge recent week inflates just as hard as a bad
          // one would have been "protected" against, and early in the
          // season "recent" can be a single outlier game). Blend instead,
          // mostly weighted to the forward projection, so any one game
          // only nudges value rather than swinging it either direction.
          const recent = form(ctx, P);
          const prod = recent != null ? 0.7 * effOf(ctx, pid) + 0.3 * recent : effOf(ctx, pid);
          const vorK = Math.max(0, prod - replacement(ctx)[P.pos]) * 5;
          v = 0.6 * vorK * keeperMult(P.kprd);
        } else if (ctx.dyn && P.rank != null) {
          const base = 100 * Math.exp(-P.rank / 90);
          v = 0.85 * base * ageMult(P.pos, P.age) + 0.15 * vor;
        } else if (ctx.dyn) v = 0.6 * vor * ageMult(P.pos, P.age);
        else v = vor;
      }
    }
    v = r1(v);
    ctx.vcache.set(pid, v);
    return v;
  }

  function pickValue(pk, season) {
    const y = Number(pk.s) - Number(season);
    return r1((PICK_VALUE[pk.rd] || 3) * (y <= 1 ? 1 : 0.88));
  }

  // ---------- waivers ----------
  function minKeep(ctx, pos) {
    if (pos === 'QB') return rawSlots(ctx.lg).includes('SUPER_FLEX') ? 2 : 1;
    if (pos === 'K' || pos === 'DEF' || pos === 'TE') return 1;
    return 0;
  }

  function dropCandidate(ctx, team, excludePid) {
    const st = new Set(team.starters);
    const bench = benchOf(team).filter((p) => !st.has(p) && p !== excludePid);
    const counts = {};
    activeOf(team).forEach((p) => { const pos = ctx.players[p] && ctx.players[p].pos; counts[pos] = (counts[pos] || 0) + 1; });
    const keepVal = (p) => (ctx.dyn ? valueOf(ctx, p) : effOf(ctx, p));
    const ok = bench.filter((p) => ctx.players[p] && counts[ctx.players[p].pos] > minKeep(ctx, ctx.players[p].pos));
    ok.sort((a, b) => keepVal(a) - keepVal(b));
    return ok[0] || null;
  }

  function waivers(ctx, opts) {
    const positions = (opts && opts.positions) || ['RB', 'WR', 'TE'];
    const team = myTeam(ctx);
    const active = activeOf(team);
    const baseLineup = optimalLineup(ctx, active);
    const base = baseLineup.total;
    const rostered = new Set(ctx.lg.teams.flatMap((t) => t.players));
    const pool = (ctx.lg.free_agents || []).filter((p) => ctx.players[p] && !rostered.has(p) && positions.includes(ctx.players[p].pos));
    const trendSet = new Set(ctx.D.trending || []);
    const rows = pool.map((pid) => {
      const gain = optimalLineup(ctx, [...active, pid]).total - base;
      const drop = dropCandidate(ctx, team, pid);
      const P = ctx.players[pid];
      return {
        pid, eff: r1(effOf(ctx, pid)), gain: r1(gain), drop, trending: trendSet.has(pid),
        value: valueOf(ctx, pid), facts: facts(ctx, pid).out,
        dropValue: drop ? (ctx.dyn ? valueOf(ctx, drop) : r1(effOf(ctx, drop))) : null,
        candValue: ctx.dyn ? valueOf(ctx, pid) : r1(effOf(ctx, pid)),
        young: ctx.dyn && P.age != null && P.age <= 23 && P.rank != null,
      };
    });
    const upgrades = rows.filter((r) => r.gain >= 0.5).sort((a, b) => b.gain - a.gain).slice(0, 8);

    const st = new Set(optimalLineup(ctx, active).slots.map((x) => x.pid));
    const bench = active.filter((p) => !st.has(p));
    const target = { RB: 2, WR: 2, TE: 1, QB: ctx.lg.slots.includes('SUPER_FLEX') ? 1 : 0, K: 0, DEF: 0 };
    const thin = positions.filter((pos) => bench.filter((p) => ctx.players[p] && ctx.players[p].pos === pos).length < target[pos]);
    const byNeed = [];
    thin.forEach((pos) => {
      rows.filter((r) => ctx.players[r.pid].pos === pos).sort((a, b) => b.eff - a.eff).slice(0, 3).forEach((r) => byNeed.push({ ...r, pos }));
    });
    const trending = rows.filter((r) => r.trending).sort((a, b) => b.eff - a.eff).slice(0, 6);
    const stash = ctx.dyn ? rows.filter((r) => r.young).sort((a, b) => b.value - a.value).slice(0, 5) : [];
    const best = rows.slice().sort((a, b) => b.eff - a.eff).slice(0, 8);
    const openSpots = Math.max(0, ctx.lg.slots.length - active.length);
    return { upgrades, byNeed, thin, trending, stash, best, count: rows.length, openSpots };
  }

  // ---------- trades ----------
  function positionReport(ctx) {
    const lg = ctx.lg;
    const slots = rawSlots(lg);
    const me = myTeam(ctx);
    const opt = optimalLineup(ctx, activeOf(me));
    const usedSet = new Set(opt.slots.map((x) => x.pid).filter(Boolean));
    const rep = [];
    for (const pos of TRADE_POS) {
      const k = slots.filter((s) => s === pos).length;
      if (pos === 'QB' && !k) continue;
      const mine = activeOf(me).filter((p) => ctx.players[p] && ctx.players[p].pos === pos).sort((a, b) => valueOf(ctx, b) - valueOf(ctx, a));
      const kth = (team) => {
        const list = activeOf(team).filter((p) => ctx.players[p] && ctx.players[p].pos === pos).map((p) => effOf(ctx, p)).sort((a, b) => b - a);
        return list[Math.max(0, k - 1)] || 0;
      };
      const all = lg.teams.map(kth).sort((a, b) => a - b);
      const median = all[Math.floor(all.length / 2)];
      const mineK = kth(me);
      const benchStrong = mine.filter((p) => !usedSet.has(p) && effOf(ctx, p) >= median * 0.85 && effOf(ctx, p) > 0);
      let status = 'balanced';
      if (mineK < median - 1.5) status = 'need';
      else if (benchStrong.length) status = 'surplus';
      rep.push({ pos, status, weakest: r1(mineK), median: r1(median), surplus: benchStrong.slice(0, 3) });
    }
    return rep;
  }

  function combos(assets, maxN, cap, fn) {
    const rec = (start, chosen, sum) => {
      if (chosen.length) fn(chosen, sum);
      if (chosen.length >= maxN) return;
      for (let i = start; i < assets.length; i++) {
        const a = assets[i];
        if (sum + a.v > cap) continue;
        if (a.type === 'player' && chosen.some((c) => c.type === 'player' && c.pos === a.pos)) continue;
        if (a.type === 'pick' && chosen.some((c) => c.type === 'pick')) continue;
        chosen.push(a);
        rec(i + 1, chosen, sum + a.v);
        chosen.pop();
      }
    };
    rec(0, [], 0);
  }

  function tradeOffers(ctx, opts) {
    const o = opts || {};
    const maxGive = o.maxGive || 3;
    const lg = ctx.lg;
    const me = myTeam(ctx);
    const season = ctx.D.season;
    const baseMe = optimalLineup(ctx, activeOf(me)).total;

    const assets = [];
    me.players.forEach((p) => {
      const P = ctx.players[p];
      if (!P || !TRADE_POS.includes(P.pos)) return;
      const v = valueOf(ctx, p);
      // Shopping specific players (mustGive): include them regardless of value --
      // the user picked them deliberately, so don't drop a low-value bench guy.
      // Keeper-league players with a real draft/keeper investment (kprd set)
      // are worth offering as package depth even when this week's marginal
      // production over replacement is thin -- a committee back's current
      // vor can sit near zero while he's still a real, kept asset, and the
      // combos()/ratio-fairness check below already keeps a low-value piece
      // from distorting a package on its own.
      const keeperAsset = ctx.dyn && P.kprd != null;
      if (v >= 4 || keeperAsset || (o.mustGive && o.mustGive.includes(p))) assets.push({ type: 'player', pid: p, pos: P.pos, v });
    });
    (me.picks || []).filter((pk) => pk.from !== undefined).forEach((pk) => assets.push({ type: 'pick', pk, v: pickValue(pk, season) }));
    assets.sort((a, b) => b.v - a.v);
    const pool = assets.slice(0, 16);
    if (o.mustGive) {
      // Guarantee a low-value mustGive asset survives the top-16 trim.
      for (const pid of o.mustGive) {
        if (!pool.some((a) => a.type === 'player' && a.pid === pid)) {
          const a = assets.find((x) => x.type === 'player' && x.pid === pid);
          if (a) pool.push(a);
        }
      }
    }

    const results = [];
    for (const opp of lg.teams) {
      if (opp.roster_id === me.roster_id) continue;
      const baseThem = optimalLineup(ctx, activeOf(opp)).total;
      const oppActive = activeOf(opp);
      // Targeting specific players (playerIds): find offers for exactly those
      // guys, whatever their value -- the user already decided they want them,
      // so skip the "must be a notable asset" floor used for open-ended scans.
      const targets = opp.players
        .filter((p) => ctx.players[p] && TRADE_POS.includes(ctx.players[p].pos)
          && (o.playerIds ? o.playerIds.includes(p) : (!o.pos || ctx.players[p].pos === o.pos)))
        .map((p) => ({ pid: p, v: valueOf(ctx, p) }))
        .filter((t) => o.playerIds || t.v >= 12)
        .sort((a, b) => b.v - a.v)
        .slice(0, o.playerIds ? o.playerIds.length : 10);
      for (const G of targets) {
        combos(pool, maxGive, G.v * 2.2, (give, rawSum) => {
          // Depth is worth less than stars: later assets in a package count for less.
          const sum = give.map((x) => x.v).sort((a, b) => b - a).reduce((t, v, i) => t + v * [1, 0.7, 0.5][i], 0);
          const ratio = sum / G.v;
          if (ratio < 0.85 || ratio > 1.35) return;
          const givePlayers = give.filter((x) => x.type === 'player').map((x) => x.pid);
          // Shopping specific players: only keep packages that actually include one.
          if (o.mustGive && !o.mustGive.some((pid) => givePlayers.includes(pid))) return;
          const meAfter = activeOf(me).filter((p) => !givePlayers.includes(p)).concat(G.pid);
          const themAfter = oppActive.filter((p) => p !== G.pid).concat(givePlayers);
          const dMe = optimalLineup(ctx, meAfter).total - baseMe;
          const dThem = optimalLineup(ctx, themAfter).total - baseThem;
          const vDiff = G.v - sum;
          const hasPick = give.some((x) => x.type === 'pick');
          const themOk = ctx.dyn ? (ratio >= 0.95 && (dThem >= -6 || (hasPick && ratio >= 1 && dThem >= -8))) || dThem >= 1 : dThem >= 0.3;
          const meOk = dMe >= 0.5 || (ctx.dyn && vDiff >= 5 && dMe >= -1.5);
          if (!themOk || !meOk) return;
          const score = dMe + 0.5 * Math.min(Math.max(dThem, 0), 2) + 0.25 * Math.max(Math.min(dThem, 0), -8) + (ctx.dyn ? 0.1 * vDiff : 0) - 0.15 * (give.length - 1);
          results.push({ opp, give: give.slice(), get: G.pid, dMe: r1(dMe), dThem: r1(dThem), vGive: r1(sum), vGet: G.v, ratio, score });
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    const perTeam = {};
    const perGet = {};
    // Targeting or shopping specific players: show a few different package
    // ideas instead of the one-offer-per-player cap used for open-ended scans.
    const anchored = o.playerIds || o.mustGive;
    const getCap = anchored ? 3 : 1;
    const teamCap = anchored ? 4 : 2;
    const picked = [];
    for (const r of results) {
      const kt = r.opp.roster_id;
      if ((perTeam[kt] || 0) >= teamCap || (perGet[r.get] || 0) >= getCap) continue;
      perTeam[kt] = (perTeam[kt] || 0) + 1;
      perGet[r.get] = (perGet[r.get] || 0) + 1;
      picked.push(decorate(ctx, r));
      if (picked.length >= (o.limit || 8)) break;
    }
    return picked;
  }

  function decorate(ctx, r) {
    const G = ctx.players[r.get];
    let tier = 'Fair';
    if (r.ratio >= 1.15) tier = 'You overpay a little';
    else if (r.ratio < 0.95) tier = 'Asking for a discount';
    if (r.ratio < 1 && valueOf(ctx, r.get) >= 60) tier = 'Big ask';
    const why = [];
    const dMe = r.dMe;
    if (dMe >= 0.5) why.push(`${G.n} starts for you (${dMe > 0 ? '+' : ''}${dMe} pts a week)`);
    if (ctx.dyn && r.vGet - r.vGive >= 5) why.push(`You come out ahead on long-term value (+${r1(r.vGet - r.vGive)})`);
    if (r.dThem >= 0.3) why.push(`Helps ${r.opp.name} too (+${r.dThem} pts a week)`);
    return { ...r, tier, why };
  }

  // ---------- matchup and alerts ----------
  function matchup(ctx) {
    const lg = ctx.lg;
    const me = myTeam(ctx);
    const opp = lg.opp ? teamOf(lg, lg.opp) : null;
    const mine = currentLineup(ctx, me).total;
    if (!opp) return null;
    const theirs = currentLineup(ctx, opp).total;
    return { me: r1(mine), opp: r1(theirs), oppTeam: opp, margin: r1(mine - theirs) };
  }

  function buildAlerts(ctx) {
    const lg = ctx.lg;
    const me = myTeam(ctx);
    const alerts = [];
    const nm = (p) => (ctx.players[p] ? ctx.players[p].n : p);
    const advice = lineupAdvice(ctx);
    const best = (slot, exclude) => {
      const elig = ELIG[slot];
      return benchOf(me).filter((p) => !exclude.has(p) && ctx.players[p] && elig.includes(ctx.players[p].pos) && effOf(ctx, p) > 0).sort((a, b) => effOf(ctx, b) - effOf(ctx, a))[0];
    };
    advice.current.slots.forEach((row) => {
      if (!row.pid) {
        alerts.push({ sev: 'now', tab: 'waivers', title: `Empty ${row.slot} slot`, body: `Nobody is starting here. Pick one up on Waivers (turn on ${row.slot} in the position chips).` });
        return;
      }
      const P = ctx.players[row.pid];
      const rep = best(row.slot, new Set());
      const repTxt = rep ? ` Best replacement: ${nm(rep)} (${r1(projOf(ctx, rep))}).` : '';
      if (injFactor(P.inj) === 0 || P.inj === 'Doubtful') {
        alerts.push({ sev: 'now', tab: 'lineup', pid: row.pid, title: `${nm(row.pid)} is ${P.inj === 'IR' ? 'on IR' : P.inj} and in your lineup`, body: `Starting at ${row.slot}.${repTxt}` });
      } else if (ctx.hasProj && !P.p && P.pos !== 'DEF') {
        alerts.push({ sev: 'now', tab: 'lineup', pid: row.pid, title: `${nm(row.pid)} has no projection this week`, body: `Likely a bye or inactive. He is starting at ${row.slot}.${repTxt}` });
      } else if (P.inj === 'Questionable') {
        alerts.push({ sev: 'soon', tab: 'lineup', pid: row.pid, title: `${nm(row.pid)} is Questionable`, body: `Check status before kickoff.${repTxt}` });
      }
    });
    advice.swaps.filter((s) => s.gain >= 1.5 && s.out).forEach((s) => {
      alerts.push({ sev: 'soon', tab: 'lineup', pid: s.in, title: `Start ${nm(s.in)} over ${nm(s.out)}`, body: `Worth about +${s.gain} points this week.` });
    });
    const irFree = (lg.ir_slots || 0) - (me.reserve || []).length;
    if (irFree > 0) {
      benchOf(me).filter((p) => ctx.players[p] && ['Out', 'IR'].includes(ctx.players[p].inj)).slice(0, irFree).forEach((p) => {
        alerts.push({ sev: 'info', tab: 'roster', pid: p, title: `Move ${nm(p)} to IR`, body: `He is ${ctx.players[p].inj} and taking a bench spot. You have an open IR slot.` });
      });
    }
    const w = waivers(ctx, {});
    if (w.upgrades[0] && w.upgrades[0].gain >= 2) {
      const u = w.upgrades[0];
      alerts.push({ sev: 'soon', tab: 'waivers', pid: u.pid, title: `Waiver target: ${nm(u.pid)}`, body: `Would add about +${u.gain} points a week to your lineup.${u.drop ? ` Drop ${nm(u.drop)}.` : ''}` });
    }
    const m = matchup(ctx);
    if (m) {
      const tight = Math.abs(m.margin) < 6;
      alerts.push({
        sev: 'info', tab: 'roster', title: tight ? `Close matchup vs ${m.oppTeam.name}` : (m.margin > 0 ? `Favored vs ${m.oppTeam.name}` : `Underdog vs ${m.oppTeam.name}`),
        body: `Projected ${m.me} to ${m.opp}. ${tight ? 'Every lineup point counts.' : ''}`.trim(),
      });
    }
    const unk = unknownSlots(lg);
    if (unk.length) alerts.push({ sev: 'info', tab: 'lineup', title: 'Some lineup slots are not supported', body: `This league uses ${[...new Set(unk)].join(', ')} slots, which are ignored in advice.` });
    const order = { now: 0, soon: 1, info: 2 };
    alerts.sort((a, b) => order[a.sev] - order[b.sev]);
    return alerts;
  }

  return {
    ELIG, makeCtx, effOf, projOf, valueOf, pickValue, replacement, optimalLineup, currentLineup, lineupAdvice,
    waivers, positionReport, tradeOffers, matchup, buildAlerts, activeOf, benchOf, myTeam, teamOf, unknownSlots, rawSlots,
    facts, ageMult, r1,
  };
});
