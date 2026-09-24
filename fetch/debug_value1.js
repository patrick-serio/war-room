/* Temporary diagnostic: run the REAL site/logic.js against the live
   deployed leagues.json to check valueOf() for Belichicks Receivers
   players, and see how many/which assets clear the trade-offer
   thresholds -- to find out if the keeper-cost formula is zeroing out
   the asset pool. */
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
  console.log('league:', lg.id, lg.name, 'format=', lg.format, 'keepers=', lg.keepers);
  const ctx = FF.makeCtx(D, lg);
  console.log('ctx.dyn =', ctx.dyn);

  const me = lg.teams.find((t) => t.roster_id === lg.me);
  console.log('\nmy roster values:');
  const rows = me.players.map((pid) => {
    const P = D.players[pid];
    if (!P) return null;
    return { pid, n: P.n, pos: P.pos, kprd: P.kprd, proj: P.p, v: FF.valueOf(ctx, pid) };
  }).filter(Boolean);
  rows.sort((a, b) => b.v - a.v);
  rows.forEach((r) => console.log(`  ${r.n} (${r.pos}) kprd=${r.kprd} v=${r.v}`));

  console.log('\nhow many of MY roster players clear v>=4 (trade asset floor)?');
  console.log(rows.filter((r) => r.v >= 4).length, '/', rows.length);

  console.log('\ntrade offers by position (scan mode, maxGive 3):');
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const offers = FF.tradeOffers(ctx, { pos, maxGive: 3 });
    console.log(`  ${pos}: ${offers.length} offers`);
  }

  console.log('\nno-position-filter scan (all TRADE_POS), maxGive 3:');
  const allOffers = FF.tradeOffers(ctx, { maxGive: 3 });
  console.log('offers found:', allOffers.length);
  allOffers.slice(0, 3).forEach((o) => console.log(JSON.stringify(o)));

  console.log('\nopposing rosters: how many players clear the v>=12 target floor?');
  lg.teams.filter((t) => t.roster_id !== lg.me).forEach((t) => {
    const targets = t.players.filter((p) => D.players[p] && ['QB','RB','WR','TE'].includes(D.players[p].pos))
      .map((p) => ({ pid: p, v: FF.valueOf(ctx, p) })).filter((x) => x.v >= 12);
    console.log(`  ${t.name}: ${targets.length} players clear v>=12`, targets.map((x) => `${D.players[x.pid].n}(${x.v})`).join(', '));
  });

  console.log('\nMY players clearing v>=4 (trade-asset floor), for reference:');
  console.log(rows.filter((r) => r.v >= 4).map((r) => `${r.n}(${r.v})`).join(', '));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
