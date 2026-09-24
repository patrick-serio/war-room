/* Temporary diagnostic: why does Cod Squad (plain redraft, ctx.dyn=false)
   show zero trade offers no matter what's selected? Check asset pool
   sizes and manually inspect what dMe/dThem values real candidate trades
   would produce, to see how far off the redraft thresholds are. */
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
  const lg = D.leagues.find((l) => l.id === 'espn:43688494');
  console.log('league:', lg.id, lg.name, 'format=', lg.format);
  const ctx = FF.makeCtx(D, lg);
  console.log('ctx.dyn =', ctx.dyn);

  const me = lg.teams.find((t) => t.roster_id === lg.me);
  const rows = me.players.map((pid) => {
    const P = D.players[pid];
    if (!P) return null;
    return { pid, n: P.n, pos: P.pos, v: FF.valueOf(ctx, pid) };
  }).filter(Boolean).sort((a, b) => b.v - a.v);
  console.log('\nmy roster values:');
  rows.forEach((r) => console.log(`  ${r.n} (${r.pos}) v=${r.v}`));
  console.log(`clear v>=4: ${rows.filter((r) => r.v >= 4).length} / ${rows.length}`);

  console.log('\ntrade offers (no filter, maxGive 3):', FF.tradeOffers(ctx, { maxGive: 3 }).length);

  // Manually check: for my best asset traded 1-for-1 for various opponents'
  // players, what dMe/dThem would result? (redraft themOk: dThem>=0.3, meOk: dMe>=0.5)
  console.log('\nmanual 1-for-1 checks (my best RB/WR for their best RB/WR):');
  const active = FF.activeOf(me);
  const baseMe = FF.optimalLineup(ctx, active).total;
  lg.teams.filter((t) => t.roster_id !== lg.me).slice(0, 4).forEach((opp) => {
    const oppActive = FF.activeOf(opp);
    const baseThem = FF.optimalLineup(ctx, oppActive).total;
    const myBest = rows[0];
    const theirBest = opp.players.map((p) => ({ pid: p, n: D.players[p] ? D.players[p].n : p, v: FF.valueOf(ctx, p) }))
      .filter((x) => D.players[x.pid] && ['QB','RB','WR','TE'].includes(D.players[x.pid].pos))
      .sort((a, b) => b.v - a.v)[0];
    if (!theirBest) return;
    const meAfter = active.filter((p) => p !== myBest.pid).concat(theirBest.pid);
    const themAfter = oppActive.filter((p) => p !== theirBest.pid).concat(myBest.pid);
    const dMe = FF.optimalLineup(ctx, meAfter).total - baseMe;
    const dThem = FF.optimalLineup(ctx, themAfter).total - baseThem;
    console.log(`  ${myBest.n}(v${myBest.v}) <-> ${theirBest.n}(v${theirBest.v}) [${opp.name}]: dMe=${dMe.toFixed(2)} dThem=${dThem.toFixed(2)}`);
  });
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
