# War Room

Phone-first fantasy football helper. A scheduled GitHub Action pulls Sleeper and
ESPN data (`fetch/build_data.py`, `fetch/espn.py`), writes `site/data/leagues.json`,
and deploys `site/` to GitHub Pages. All analysis (lineup, waivers, trades, alerts)
runs in the browser from `site/logic.js`.

- `fetch/` data fetchers (`build_data.py` for Sleeper, `espn.py` for ESPN) and output sanity check
- `site/` the static app (`index.html`, `app.js`, `logic.js`, `style.css`, `data/demo.json`)
- `tests/` logic tests (`node tests/logic.test.js`), browser tests (`tests/e2e.js`), mock Sleeper server
- `tools/make_preview.py` builds a single-file demo-only preview
- `.github/workflows/refresh.yml` refresh every 3 hours and deploy

ESPN leagues need `ESPN_SWID` and `ESPN_S2` (from a logged-in ESPN browser session's
cookies) stored as GitHub Actions secrets, plus the league IDs listed in
`ESPN_LEAGUE_IDS` in `refresh.yml` (comma-separated). ESPN leagues are treated as
redraft only for now (no taxi squad, no tradeable future picks).

A league with `draftSettings.keeperCount > 0` is tagged format "keeper" and
gets long-term-value trade logic (like dynasty Sleeper leagues), weighted by
each player's keeper cost -- the draft round he currently occupies, from
`draftDetail.picks`. Some keeper assignments (e.g. a commissioner-run manual
keeper process) aren't in any ESPN-queryable draft or transaction record; add
those by hand in `ESPN_KEEPER_OVERRIDES` in `refresh.yml`
(`{"<league_id>": {"<espn player id>": <round>}}`).
