# War Room

Phone-first fantasy football helper. A scheduled GitHub Action pulls Sleeper data
(`fetch/build_data.py`), writes `site/data/leagues.json`, and deploys `site/` to GitHub Pages.
All analysis (lineup, waivers, trades, alerts) runs in the browser from `site/logic.js`.

- `fetch/` data fetcher and output sanity check
- `site/` the static app (`index.html`, `app.js`, `logic.js`, `style.css`, `data/demo.json`)
- `tests/` logic tests (`node tests/logic.test.js`), browser tests (`tests/e2e.js`), mock Sleeper server
- `tools/make_preview.py` builds a single-file demo-only preview
- `.github/workflows/refresh.yml` refresh every 3 hours and deploy

ESPN support is not built yet. It needs the ESPN cookies (`SWID`, `espn_s2`) stored as GitHub secrets.
