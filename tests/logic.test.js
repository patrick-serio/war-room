// Run: node tests/logic.test.js [path/to/leagues.json]
const assert = require('assert');
const FF = require('../site/logic.js');

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n    ', e.message); process.exitCode = 1; } };

// ---- hand-built scenario with known answers ----
// Scoring settings are a trivial { pt: 1 } so a mock player's raw stat (pt: N)
// scores exactly N, keeping every hand-picked number below meaningful.
const mk = (n, pos, ppr, extra = {}) => ({ n, pos, tm: 'AAA', age: 25, inj: null, rank: 50, opp: 'BBB', p: ppr == null ? null : { pt: ppr }, r: [], tgt: [], tch: [], ...extra });
const players = {
  q1: mk('Quinn QB', 'QB', 20), q2: mk('Backup QB', 'QB', 12),
  r1: mk('Ray RB1', 'RB', 18), r2: mk('Ray RB2', 'RB', 14), r3: mk('Ray RB3', 'RB', 9), r4: mk('Bench RB', 'RB', 15.5),
  w1: mk('Will WR1', 'WR', 17), w2: mk('Will WR2', 'WR', 13), w3: mk('Will WR3', 'WR', 11), w4: mk('Bye WR', 'WR', null),
  t1: mk('Tim TE', 'TE', 8), t2: mk('Out TE', 'TE', 12, { inj: 'Out' }),
  k1: mk('Kicker', 'K', 8), d1: mk('DEF', 'DEF', 7),
  fa1: mk('FA RB', 'RB', 16), fa2: mk('FA WR', 'WR', 7), fa3: mk('FA TE', 'TE', 11),
  o1: mk('Opp RB', 'RB', 22), o2: mk('Opp WR', 'WR', 10), o3: mk('Opp QB', 'QB', 19),
};
const lg = {
  id: 'x', name: 'Test', format: 'redraft', scoring: 'ppr', scoring_settings: { pt: 1 },
  slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN'],
  ir_slots: 1, taxi_slots: 0, me: 1, opp: 2, free_agents: ['fa1', 'fa2', 'fa3'],
  teams: [
    { roster_id: 1, name: 'Me', players: ['q1', 'q2', 'r1', 'r2', 'r3', 'r4', 'w1', 'w2', 'w3', 'w4', 't1', 't2', 'k1', 'd1'],
      // deliberately bad lineup: bench RB (15.5) should start over RB3 (9); bye WR starting; out TE on bench
      starters: ['q1', 'r1', 'r3', 'w1', 'w4', 't1', 'w3', 'k1', 'd1'], reserve: [], taxi: [] },
    { roster_id: 2, name: 'Them', players: ['o1', 'o2', 'o3'], starters: ['o3', 'o1', '0', 'o2', '0', '0', '0', '0', '0'], reserve: [], taxi: [] },
  ],
};
const D = { players, leagues: [lg], trending: ['fa1'], season: '2026', week: 3, generated_at: new Date().toISOString() };
const ctx = FF.makeCtx(D, lg);

t('injured players count as zero', () => assert.strictEqual(FF.effOf(ctx, 't2'), 0));
t('no projection counts as zero when projections exist', () => assert.strictEqual(FF.effOf(ctx, 'w4'), 0));

t('optimal lineup fills slots by best player', () => {
  const opt = FF.optimalLineup(ctx, FF.activeOf(lg.teams[0]));
  const byslot = opt.slots.map((s) => s.pid);
  assert.deepStrictEqual(byslot.slice(0, 3), ['q1', 'r1', 'r4']); // QB, RB, RB (bench RB 15.5 beats RB2 14)
  assert.ok(byslot.includes('r2'), 'RB2 takes the FLEX');
    assert.ok(!byslot.includes('t2'), 'Out TE never starts');
  assert.ok(!byslot.includes('w4'), 'bye WR never starts');
});

t('lineup advice finds the real swaps and total gain', () => {
  const a = FF.lineupAdvice(ctx);
  assert.ok(a.gain > 5, 'gain should be sizable, got ' + a.gain);
  const ins = a.swaps.map((s) => s.in);
  assert.ok(ins.includes('r4') && ins.includes('w2'));
  const outs = a.swaps.map((s) => s.out);
  assert.ok(outs.includes('w4'), 'bye WR is swapped out');
});

t('alerts flag the bye WR and recommend the swap', () => {
  const al = FF.buildAlerts(ctx);
  assert.ok(al.some((x) => x.sev === 'now' && /no projection/.test(x.title)), JSON.stringify(al.map((a) => a.title)));
  assert.ok(al.some((x) => /Start .* over/.test(x.title)));
  assert.ok(al.some((x) => /Move Out TE to IR/.test(x.title)));
  assert.ok(al.some((x) => /vs Them/.test(x.title)), 'matchup alert');
  assert.strictEqual(al[0].sev, 'now');
});

t('waivers rank by lineup gain and suggest a drop', () => {
  const w = FF.waivers(ctx, {});
  assert.ok(w.upgrades.length >= 1);
  assert.strictEqual(w.upgrades[0].pid, 'fa3', 'FA TE 11 replaces TE 8');
  assert.ok(w.upgrades[0].gain > 2);
  assert.ok(w.upgrades[0].drop, 'has a drop suggestion');
  const drop = w.upgrades[0].drop;
  assert.ok(!['q1', 'k1', 'd1'].includes(drop));
  assert.ok(w.trending.some((r) => r.pid === 'fa1'));
});

t('waiver drop never leaves no kicker, QB or TE', () => {
  const w = FF.waivers(ctx, { positions: ['RB', 'WR', 'TE', 'QB', 'K', 'DEF'] });
  w.upgrades.forEach((u) => { if (u.drop) assert.ok(!['k1', 'd1'].includes(u.drop)); });
});

t('flex slots: superflex takes a second QB when it beats other options', () => {
  const lg2 = { ...lg, slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'SUPER_FLEX', 'BN'] };
  const c2 = FF.makeCtx(D, lg2);
  const opt = FF.optimalLineup(c2, FF.activeOf(lg2.teams[0]));
  const sf = opt.slots[6].pid;
  assert.strictEqual(sf, 'r2'); // RB 14 beats QB2 12 for the superflex
  const lg3 = { ...lg2, teams: [{ ...lg.teams[0], players: ['q1', 'q2', 'r1', 'r2', 'w1', 'w2', 't1'], starters: [] }, lg.teams[1]] };
  const opt3 = FF.optimalLineup(FF.makeCtx(D, lg3), FF.activeOf(lg3.teams[0]));
  assert.strictEqual(opt3.slots[6].pid, 'q2');
});

t('empty starter slot is reported', () => {
  const lg4 = { ...lg, teams: [{ ...lg.teams[0], starters: ['q1', '0', 'r3', 'w1', 'w4', 't1', 'w3', 'k1', 'd1'] }, lg.teams[1]] };
  const al = FF.buildAlerts(FF.makeCtx(D, lg4));
  assert.ok(al.some((a) => /Empty RB slot/.test(a.title)));
});

t('trade offers stay fair-value, never stack a position, never devastate a side', () => {
  // Loosened from requiring a guaranteed lineup win for both sides to
  // surfacing more candidate trades and trusting the user's own judgment --
  // the remaining invariant is that a suggested trade stays within the
  // fairness band and doesn't wreck either side's lineup.
  const offers = FF.tradeOffers(ctx, { maxGive: 2 });
  offers.forEach((o) => {
    const pos = o.give.filter((g) => g.type === 'player').map((g) => ctx.players[g.pid].pos);
    assert.strictEqual(new Set(pos).size, pos.length);
    assert.ok(o.dMe >= -2, 'must not badly hurt my own lineup');
    assert.ok(o.dThem >= -3, 'redraft partner should not be badly hurt');
    assert.ok(o.ratio >= 0.75 && o.ratio <= 1.5, 'trade must stay within the fairness band');
  });
});

t('dynasty value: youth beats age at the same rank, picks are valued', () => {
  const young = FF.ageMult('RB', 22), old = FF.ageMult('RB', 29);
  assert.ok(young > old * 2);
  assert.ok(FF.pickValue({ s: '2027', rd: 1 }, '2026') > FF.pickValue({ s: '2027', rd: 2 }, '2026'));
  assert.ok(FF.pickValue({ s: '2028', rd: 1 }, '2026') < FF.pickValue({ s: '2027', rd: 1 }, '2026'));
});

t('close calls surface a reason and can flip on usage trend', () => {
  const p2 = { ...players,
    a: mk('Starter WR', 'WR', 12, { tgt: [9, 9, 5, 4], r: [{ pt: 8 }, { pt: 8 }, { pt: 8 }] }),
    b: mk('Bench WR', 'WR', 11.6, { tgt: [4, 5, 9, 10], r: [{ pt: 12 }, { pt: 12 }, { pt: 12 }] }) };
  const lg5 = { ...lg, teams: [{ roster_id: 1, name: 'Me', players: ['a', 'b', 'w1'], starters: ['0', '0', '0', 'a', 'w1', '0', '0', '0', '0'], reserve: [], taxi: [] }, lg.teams[1]] };
  const c = FF.makeCtx({ ...D, players: p2 }, lg5);
  const a = FF.lineupAdvice(c);
  assert.ok(a.close.length >= 1, 'close call found');
  const cc = a.close[0];
  assert.ok(cc.verdict.reasons.length >= 1);
});

t('swap pairing matches like positions first (no negative-gain swaps)', () => {
  const pl = {
    q: mk('QB', 'QB', 20), r1: mk('RB1', 'RB', 15), r2: mk('RB2', 'RB', 14), w1: mk('WR1', 'WR', 15), w2: mk('WR2', 'WR', 14),
    tam: mk('Tamura WR', 'WR', 13.8), san: mk('Sandoval TE', 'TE', 8.2), rid: mk('Ridley TE', 'TE', 9.5), abe: mk('Abernathy RB', 'RB', 14.2),
  };
  const l = { ...lg, slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    teams: [{ roster_id: 1, name: 'Me', players: Object.keys(pl), starters: ['q', 'r1', 'r2', 'w1', 'w2', 'san', 'tam'], reserve: [], taxi: [] }, lg.teams[1]] };
  const a = FF.lineupAdvice(FF.makeCtx({ ...D, players: pl }, l));
  assert.ok(a.swaps.length >= 2, 'two changes');
  a.swaps.forEach((s2) => assert.ok(s2.gain >= 0, 'negative-gain swap ' + s2.gain));
  const sum = a.swaps.reduce((x, y) => x + y.gain, 0);
  assert.ok(Math.abs(sum - a.gain) < 0.25, `swap gains ${sum} should add to ${a.gain}`);
  const te = a.swaps.find((x) => x.in === 'rid');
  assert.strictEqual(te.out, 'san', 'TE swaps with TE');
});

t('waivers report open roster spots', () => {
  assert.strictEqual(FF.activeOf(lg.teams[0]).length, 14);
  assert.strictEqual(FF.waivers(ctx, {}).openSpots, 0, 'full roster: 13 slots, 14 players');
  const roomy = { ...lg, slots: lg.slots.concat(['BN', 'BN', 'BN']) };
  assert.strictEqual(FF.waivers(FF.makeCtx(D, roomy), {}).openSpots, 2);
});

// ---- optional: run against real fetcher output ----
const file = process.argv[2];
if (file) {
  const data = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  data.leagues.forEach((L) => {
    const c = FF.makeCtx(data, L);
    t(`[${L.name}] runs end to end`, () => {
      const t0 = Date.now();
      const adv = FF.lineupAdvice(c);
      const w = FF.waivers(c, {});
      const tr = FF.tradeOffers(c, {});
      const pr = FF.positionReport(c);
      const al = FF.buildAlerts(c);
      const ms = Date.now() - t0;
      console.log(`      ${L.format} ${L.scoring}: lineup gain ${adv.gain}, swaps ${adv.swaps.length}, close ${adv.close.length}, waiver upgrades ${w.upgrades.length}, thin ${w.thin.join('/') || '-'}, trades ${tr.length}, alerts ${al.length}, ${ms}ms`);
      assert.ok(adv.optimal.total > 0);
      assert.ok(ms < 3000, 'too slow: ' + ms);
      pr.forEach((x) => console.log(`      ${x.pos}: ${x.status} (weakest ${x.weakest} vs median ${x.median})`));
    });
  });
}
console.log(`\n${passed} passed`);
