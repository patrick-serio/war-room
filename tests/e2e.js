// Run: NODE_PATH=$(npm root -g) node tests/e2e.js   (site must be served on :8080)
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && extra ? ' -> ' + extra : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const mkPage = async (scheme, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, ...opts });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    return { ctx, page, errors };
  };
  const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const mainText = (page) => page.locator('main').innerText();

  // ---- light mode, every tab, dynasty league ----
  let { page, errors, ctx } = await mkPage('light');
  await page.goto('http://localhost:8080/index.html');
  await page.waitForSelector('.lg-btn .nm');
  check('header shows league name', (await page.locator('.lg-btn .nm').innerText()).includes('Dynasty Degenerates'));
  for (const tab of ['roster', 'lineup', 'waivers', 'trades', 'alerts']) {
    await page.click(`nav.tabs [data-tab="${tab}"]`);
    const t = await mainText(page);
    check(`${tab}: renders content`, t.length > 80 && !/Something went wrong/.test(t), t.slice(0, 120));
    check(`${tab}: no horizontal scroll`, await noHScroll(page));
    await page.screenshot({ path: `${OUT}/light-${tab}.png`, fullPage: true });
  }
  check('dynasty roster shows picks and taxi', await (async () => { await page.click('nav.tabs [data-tab="roster"]'); const t = await mainText(page); return /Draft picks/i.test(t) && /Taxi squad/i.test(t); })());
  check('dynasty roster shows player value', /Value \d+/.test(await mainText(page)));

  // trades: target mode
  await page.click('nav.tabs [data-tab="trades"]');
  await page.click('[data-act="tmode"][data-m="target"]');
  await page.click('[data-act="tpos"][data-pos="RB"]');
  await page.click('[data-act="tmax"][data-n="1"]');
  const tt = await mainText(page);
  check('trades target mode renders', /who do you want/i.test(tt) && (/offers worth sending/i.test(tt) || /No fair offers/i.test(tt)));
  await page.screenshot({ path: `${OUT}/light-trades-target.png`, fullPage: true });
  const copyBtn = page.locator('[data-act="copy"]').first();
  if (await copyBtn.count()) { await copyBtn.click(); await page.waitForTimeout(150); check('copy button responds', /Copied|Copy failed/.test(await copyBtn.innerText())); }

  // waivers: toggle positions
  await page.click('nav.tabs [data-tab="waivers"]');
  await page.click('[data-act="wpos"][data-pos="QB"]');
  check('waiver QB chip toggles on', (await page.locator('[data-act="wpos"][data-pos="QB"]').getAttribute('aria-pressed')) === 'true');
  await page.click('[data-act="wpos"][data-pos="RB"]');
  await page.click('[data-act="wpos"][data-pos="WR"]');
  await page.click('[data-act="wpos"][data-pos="TE"]');
  check('waivers still render with only QB', /QB/.test(await mainText(page)) && !/Something went wrong/.test(await mainText(page)));

  // league switcher
  await page.click('[data-act="sheet"]');
  const sheetText = await page.locator('.sheet').innerText();
  check('sheet lists both Sleeper leagues', /Dynasty Degenerates/.test(sheetText) && /Sunday Funday/.test(sheetText));
  check('sheet shows ESPN leagues as not connected', /Belichicks Receivers/.test(sheetText) && /not connected yet/.test(sheetText));
  check('ESPN placeholders are disabled', await page.locator('.lg-opt[disabled]').count() === 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/light-sheet.png` });
  await page.click('.lg-opt:has-text("Sunday Funday")');
  check('switched to redraft league', (await page.locator('.lg-btn .nm').innerText()).includes('Sunday Funday'));
  await page.click('nav.tabs [data-tab="roster"]');
  check('redraft roster has no picks/taxi', !/Draft picks|Taxi squad/.test(await mainText(page)));
  check('redraft roster hides dynasty value', !/Value \d+/.test(await mainText(page)));
  await page.click('nav.tabs [data-tab="lineup"]');
  await page.screenshot({ path: `${OUT}/light-redraft-lineup.png`, fullPage: true });
  // reload keeps the league and tab
  await page.reload(); await page.waitForSelector('.lg-btn .nm');
  check('league choice survives reload', (await page.locator('.lg-btn .nm').innerText()).includes('Sunday Funday'));
  check('no JS errors (light)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---- very small phone ----
  {
    const small = await mkPage('light', { viewport: { width: 320, height: 640 } });
    await small.page.goto('http://localhost:8080/index.html');
    await small.page.waitForSelector('.lg-btn .nm');
    for (const tab of ['roster', 'lineup', 'waivers', 'trades', 'alerts']) {
      await small.page.click(`nav.tabs [data-tab="${tab}"]`);
      check(`320px ${tab}: no horizontal scroll`, await noHScroll(small.page));
    }
    await small.page.screenshot({ path: `${OUT}/small-alerts.png`, fullPage: true });
    check('no JS errors (320px)', small.errors.length === 0, small.errors.join(' | '));
    await small.ctx.close();
  }

  // ---- dark mode ----
  ({ page, errors, ctx } = await mkPage('dark'));
  await page.goto('http://localhost:8080/index.html#lineup');
  await page.waitForSelector('.lg-btn .nm');
  check('hash deep link opens Lineup', (await page.locator('nav.tabs [aria-current="page"]').innerText()).includes('Lineup'));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark theme background applied', bg === 'rgb(11, 20, 16)', bg);
  await page.screenshot({ path: `${OUT}/dark-lineup.png`, fullPage: true });
  await page.click('nav.tabs [data-tab="roster"]');
  await page.screenshot({ path: `${OUT}/dark-roster.png`, fullPage: true });
  check('no JS errors (dark)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---- demo mode ----
  ({ page, errors, ctx } = await mkPage('light'));
  await page.goto('http://localhost:8080/index.html');
  await page.waitForSelector('.lg-btn .nm');
  await page.click('[data-act="sheet"]');
  await page.click('[data-act="demo"]');
  await page.waitForSelector('.chip.demo');
  check('demo shows a demo chip', /Demo/.test(await page.locator('.chip.demo').innerText()));
  await page.click('[data-act="sheet"]');
  await page.click('[data-act="live"]');
  check('back to live leagues', (await page.locator('.chip.demo').count()) === 0);
  await ctx.close();

  // ---- failure paths ----
  ({ page, errors, ctx } = await mkPage('light'));
  await page.route('**/data/leagues.json*', (r) => r.fulfill({ status: 404, body: 'nope' }));
  await page.goto('http://localhost:8080/index.html');
  await page.waitForSelector('.empty');
  const et = await page.locator('main').innerText();
  check('missing data shows a clear message', /No league data yet/.test(et) && /HTTP 404/.test(et), et);
  check('missing data still offers the demo', await page.locator('.empty [data-act="demo"]').count() === 1);
  await page.screenshot({ path: `${OUT}/light-no-data.png`, fullPage: true });
  await page.click('.empty [data-act="demo"]');
  await page.waitForSelector('.chip.demo');
  check('demo works even with no live data', /Dynasty Degenerates/.test(await page.locator('.lg-btn .nm').innerText()));
  await ctx.close();

  // ---- stale data + empty leagues ----
  ({ page, errors, ctx } = await mkPage('light'));
  await page.route('**/data/leagues.json*', async (r) => {
    const resp = await r.fetch();
    const j = await resp.json();
    j.generated_at = new Date(Date.now() - 50 * 36e5).toISOString();
    j.notes = ['Projections unavailable (test note)'];
    r.fulfill({ json: j });
  });
  await page.goto('http://localhost:8080/index.html#alerts');
  await page.waitForSelector('.lg-btn .nm');
  const at = await mainText(page);
  check('stale data warning and notes appear', /old\. The scheduled refresh may have failed/.test(at) && /test note/.test(at), at.slice(-300));
  await ctx.close();

  ({ page, errors, ctx } = await mkPage('light'));
  await page.route('**/data/leagues.json*', async (r) => { const j = await (await r.fetch()).json(); j.leagues = []; r.fulfill({ json: j }); });
  await page.goto('http://localhost:8080/index.html');
  await page.waitForSelector('.empty');
  check('no leagues on the account shows a message', /No leagues found/.test(await page.locator('main').innerText()));
  await ctx.close();

  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall e2e checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
