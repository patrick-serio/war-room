/* Temporary diagnostic: re-verify keeper valueOf() and trade offers with
   the weighted-blend fix (0.7 projection + 0.3 recent form), replacing
   the asymmetric max() that inflated values on any big recent game. */
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

  const me = lg.teams.find((t) => t.roster_id === lg.me);
  console.log('my roster values:');
  const rows = me.players.map((pid) => {
    const P = D.players[pid];
    if (!P) return null;
    return { pid, n: P.n, pos: P.pos, kprd: P.kprd, v: FF.valueOf(ctx, pid) };
  }).filter(Boolean);
  rows.sort((a, b) => b.v - a.v);
  rows.forEach((r) => console.log(`  ${r.n} (${r.pos}) kprd=${r.kprd} v=${r.v}`));
  console.log(`\nclear v>=4: ${rows.filter((r) => r.v >= 4).length} / ${rows.length}`);

  console.log('\ntrade offers by position (scan mode, maxGive 3):');
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const offers = FF.tradeOffers(ctx, { pos, maxGive: 3 });
    console.log(`  ${pos}: ${offers.length} offers`);
  }
  const allOffers = FF.tradeOffers(ctx, { maxGive: 3 });
  console.log(`no-filter: ${allOffers.length} offers`);

  console.log('\nsample of opposing top players (sanity check magnitude):');
  lg.teams.filter((t) => t.roster_id !== lg.me).slice(0, 3).forEach((t) => {
    const top = t.players.filter((p) => D.players[p]).map((p) => ({ n: D.players[p].n, v: FF.valueOf(ctx, p) }))
      .sort((a, b) => b.v - a.v).slice(0, 3);
    console.log(`  ${t.name}: ${top.map((x) => `${x.n}(${x.v})`).join(', ')}`);
  });
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
