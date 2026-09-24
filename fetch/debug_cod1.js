/* Temporary diagnostic: verify the loosened trade thresholds against both
   real ESPN leagues -- Belichicks Receivers (keeper) and Cod Squad
   (plain redraft, previously showing zero offers no matter what). */
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

  for (const leagueId of ['espn:610033022', 'espn:43688494']) {
    const lg = D.leagues.find((l) => l.id === leagueId);
    console.log(`\n=== ${lg.name} (format=${lg.format}) ===`);
    const ctx = FF.makeCtx(D, lg);
    console.log('ctx.dyn =', ctx.dyn);

    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const offers = FF.tradeOffers(ctx, { pos, maxGive: 3 });
      console.log(`  ${pos}: ${offers.length} offers`);
    }
    const allOffers = FF.tradeOffers(ctx, { maxGive: 3 });
    console.log(`  no-filter total: ${allOffers.length} offers`);
    allOffers.slice(0, 5).forEach((o) => {
      const giveNames = o.give.map((g) => g.type === 'player' ? D.players[g.pid].n : 'pick').join(' + ');
      console.log(`    give [${giveNames}] for ${D.players[o.get].n} (${o.opp.name}) dMe=${o.dMe} dThem=${o.dThem} ratio=${o.ratio.toFixed(2)}`);
    });
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
