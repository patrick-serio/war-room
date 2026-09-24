/* Temporary diagnostic: verify Corum/Pollard-tier players now appear in
   trade packages, and that offer counts increase across positions. */
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

  console.log('trade offers by position (scan mode, maxGive 3):');
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const offers = FF.tradeOffers(ctx, { pos, maxGive: 3 });
    console.log(`  ${pos}: ${offers.length} offers`);
    offers.forEach((o) => {
      const giveNames = o.give.map((g) => g.type === 'player' ? D.players[g.pid].n : `pick`).join(' + ');
      console.log(`    give [${giveNames}] for ${D.players[o.get].n} (${o.opp.name}) tier=${o.tier}`);
    });
  }
  const allOffers = FF.tradeOffers(ctx, { maxGive: 3 });
  console.log(`\nno-filter total: ${allOffers.length} offers`);

  console.log('\ndoes any package include Corum or Pollard?');
  const names = ['Blake Corum', 'Tony Pollard'];
  allOffers.forEach((o) => {
    const hit = o.give.some((g) => g.type === 'player' && names.includes(D.players[g.pid].n));
    if (hit) {
      const giveNames = o.give.map((g) => D.players[g.pid].n).join(' + ');
      console.log(`  YES: give [${giveNames}] for ${D.players[o.get].n} (${o.opp.name})`);
    }
  });

  console.log('\nShop-a-player mode for Corum specifically (mustGive):');
  const corumPid = Object.keys(D.players).find((p) => p.startsWith('espn:610033022:') && D.players[p].n === 'Blake Corum');
  const shopOffers = FF.tradeOffers(ctx, { mustGive: [corumPid], maxGive: 3 });
  console.log(`offers: ${shopOffers.length}`);
  shopOffers.forEach((o) => {
    const giveNames = o.give.map((g) => g.type === 'player' ? D.players[g.pid].n : 'pick').join(' + ');
    console.log(`  give [${giveNames}] for ${D.players[o.get].n} (${o.opp.name}) tier=${o.tier}`);
  });
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
