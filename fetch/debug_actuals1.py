"""Temporary diagnostic: does week_total(stats, 0, wk, season) (actuals,
used to build each ESPN player's "recent form" array) accidentally match a
CUMULATIVE season-to-date entry instead of a true single-week actual, due
to having no statSplitTypeId filter (unlike the projection path, which
happened to only have one matching entry)? Josh Allen's "recent" value
came back as {"pt": 46.82} for one week -- way too high for a single game,
suggesting exactly this."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LEAGUE_ID = "610033022"
JOSH_ALLEN_ID = 3918298


def main():
    session = espn.make_session(os.environ["ESPN_SWID"], os.environ["ESPN_S2"])
    season = 2026
    base = espn.league_base(session, LEAGUE_ID, season)
    d = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": ["mRoster", "mTeam"]})
    for t in d.get("teams", []):
        for e in (t.get("roster") or {}).get("entries", []):
            p = (e.get("playerPoolEntry") or {}).get("player") or {}
            if p.get("id") != JOSH_ALLEN_ID:
                continue
            stats = p.get("stats") or []
            print(f"Josh Allen: {len(stats)} total stats[] entries")
            for st in stats:
                if st.get("statSourceId") == 0:
                    print(json.dumps({k: st.get(k) for k in (
                        "id", "statSourceId", "statSplitTypeId", "scoringPeriodId", "seasonId", "appliedTotal")}))


if __name__ == "__main__":
    main()
