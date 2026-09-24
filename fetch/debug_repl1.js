/* Temporary diagnostic: check RB replacement level computation and
   whether any free agent RB actually outproduces Corum/Pollard, per the
   user's claim. Also check the v>=4 trade-asset floor against a fuller
   picture of the roster's RB depth. */
const https = require('https');
const path = require('path');
const FF = require(path.join(__dirname, '..', 'site', 'logic.js'));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

(async () => {
  const D = await fetchJSON('https://patrick-serio.github.io/war-room/data/leagues.json');
  const lg = D.leagues.find((l) => l.id === 'espn:610033022');
  const ctx = FF.makeCtx(D, lg);

  let rosteredRBCount = 0;
  lg.teams.forEach((t) => {
    const active = new Set([...(t.reserve || []), ...(t.taxi || [])]);
    t.players.filter((p) => !active.has(p)).forEach((p) => {
      const P = D.players[p];
      if (P && P.pos === 'RB') rosteredRBCount += 1;
    });
  });
  console.log('total active rostered RBs across league:', rosteredRBCount);
  console.log('lg.slots:', JSON.stringify(lg.slots));
  console.log('lg.teams.length:', lg.teams.length);
  console.log('replacement(ctx):', JSON.stringify(FF.replacement(ctx)));
  console.log('RB effOf ranking (raw, what replacement() sorts):');
  const rbEffs = [];
  lg.teams.forEach((t) => {
    const active = new Set([...(t.reserve || []), ...(t.taxi || [])]);
    t.players.filter((p) => !active.has(p)).forEach((p) => {
      const P = D.players[p];
      if (P && P.pos === 'RB') rbEffs.push({ n: P.n, eff: FF.effOf(ctx, p) });
    });
  });
  rbEffs.sort((a, b) => b.eff - a.eff);
  rbEffs.forEach((r, i) => console.log(`  ${i + 1}. ${r.n}: eff=${r.eff.toFixed ? r.eff.toFixed(2) : r.eff}`));

  const me = lg.teams.find((t) => t.roster_id === lg.me);
  console.log('\nmy RBs:');
  me.players.filter((p) => D.players[p] && D.players[p].pos === 'RB').forEach((p) => {
    const P = D.players[p];
    console.log(`  ${P.n}: proj=${JSON.stringify(P.p)} kprd=${P.kprd} v=${FF.valueOf(ctx, p)}`);
  });

  console.log('\nfree agent RBs (top 15 by value):');
  const faRBs = (lg.free_agents || []).filter((p) => D.players[p] && D.players[p].pos === 'RB')
    .map((p) => ({ n: D.players[p].n, v: FF.valueOf(ctx, p), proj: D.players[p].p }))
    .sort((a, b) => b.v - a.v);
  console.log('total FA RBs:', faRBs.length);
  faRBs.slice(0, 15).forEach((r) => console.log(`  ${r.n}: v=${r.v} proj=${JSON.stringify(r.proj)}`));

  console.log('\nall rostered RBs leaguewide, sorted by value (top 30):');
  const allRBs = lg.teams.flatMap((t) => t.players.filter((p) => D.players[p] && D.players[p].pos === 'RB'))
    .map((p) => ({ n: D.players[p].n, v: FF.valueOf(ctx, p) }))
    .sort((a, b) => b.v - a.v);
  allRBs.slice(0, 30).forEach((r, i) => console.log(`  ${i + 1}. ${r.n}: v=${r.v}`));
  console.log('...');
  console.log('bottom 10:', allRBs.slice(-10).map((r) => `${r.n}(${r.v})`).join(', '));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
