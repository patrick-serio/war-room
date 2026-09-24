#!/usr/bin/env python3
"""Temporary diagnostic #2: targeted probe for ESPN player stats/projection
shape and matchup scoring, after probe #1 got truncated before reaching them.
Not for permanent use -- delete after use."""
import json
import os

import requests

SWID = os.environ["ESPN_SWID"]
ESPN_S2 = os.environ["ESPN_S2"]
LEAGUE_IDS = ["610033022", "43688494"]
SEASON = os.environ.get("SEASON", "2026")

s = requests.Session()
s.cookies.set("SWID", SWID, domain=".espn.com")
s.cookies.set("espn_s2", ESPN_S2, domain=".espn.com")
s.headers["User-Agent"] = "fantasy-hq-debug/1.0"

BASE = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{SEASON}/segments/0/leagues"


def get(url, params=None, headers=None):
    r = s.get(url, params=params, headers=headers, timeout=30)
    print("GET", r.url, "->", r.status_code)
    return r


for lid in LEAGUE_IDS:
    print(f"\n===== LEAGUE {lid} =====")
    r = get(f"{BASE}/{lid}", params={"view": ["mSettings", "mTeam", "mRoster", "mMatchupScore", "mStatus"]})
    if r.status_code != 200:
        print("BODY:", r.text[:500])
        continue
    d = r.json()
    print("league scoringPeriodId:", d.get("scoringPeriodId"))
    print("status.currentMatchupPeriod:", d.get("status", {}).get("currentMatchupPeriod"))
    print("scoringType:", d.get("settings", {}).get("scoringSettings", {}).get("scoringType"))
    items = d.get("settings", {}).get("scoringSettings", {}).get("scoringItems", [])
    print(f"scoringItems count: {len(items)}")
    rec = [it for it in items if it.get("statId") == 53]
    print("reception (statId 53) scoring item:", rec)
    print("FULL scoringItems:", json.dumps(items))

    myswid = SWID.strip("{}").lower()
    teams = d.get("teams", [])
    mine = None
    for t in teams:
        owners = [str(o).strip("{}").lower() for o in (t.get("owners") or [])]
        if myswid in owners:
            mine = t
            break
    if not mine:
        print("Could not find my team")
        continue
    print("my team id:", mine.get("id"))
    roster = (mine.get("roster") or {}).get("entries", [])
    for e in roster[:3]:
        p = e.get("playerPoolEntry", {}).get("player", {})
        print(f"\n-- {p.get('fullName')} pos={p.get('defaultPositionId')} lineupSlotId={e.get('lineupSlotId')} --")
        stats = p.get("stats", [])
        print(f"stats entries: {len(stats)}")
        for st in stats:
            summary = {k: st.get(k) for k in ("scoringPeriodId", "statSourceId", "statSplitTypeId", "appliedTotal", "seasonId")}
            print("  ", json.dumps(summary))
        # show one full projected-current-week entry if present
        cur_week = d.get("scoringPeriodId")
        proj = next((st for st in stats if st.get("statSourceId") == 1 and st.get("scoringPeriodId") == cur_week), None)
        if proj:
            print("  PROJECTED THIS WEEK FULL:", json.dumps(proj)[:1500])
        actual = next((st for st in stats if st.get("statSourceId") == 0 and st.get("scoringPeriodId") == cur_week), None)
        if actual:
            print("  ACTUAL THIS WEEK FULL:", json.dumps(actual)[:1500])

    sched = d.get("schedule", [])
    cur_mp = d.get("status", {}).get("currentMatchupPeriod")
    my_id = mine.get("id")
    my_matchup = next((m for m in sched if m.get("matchupPeriodId") == cur_mp and
                        (m.get("home", {}).get("teamId") == my_id or m.get("away", {}).get("teamId") == my_id)), None)
    print("\nmy current matchup:", json.dumps(my_matchup, indent=2)[:2000] if my_matchup else None)
