#!/usr/bin/env python3
"""Temporary diagnostic #4: (1) get the authoritative proTeamId->abbreviation
mapping from within the fantasy API itself, (2) manually cross-validate a
QB/K/DST player's appliedTotal against Belichicks Receivers' own
scoringItems (including D/ST positionId overrides) to check whether the
reported QB/K/DST discrepancy is my bug or an ESPN-side quirk.
Not for permanent use -- delete after use."""
import json
import os

import requests

SWID = os.environ["ESPN_SWID"]
ESPN_S2 = os.environ["ESPN_S2"]
SEASON = 2026
WEEK = 3
LEAGUE_ID = "610033022"  # Belichicks Receivers -- the one reported as off

s = requests.Session()
s.cookies.set("SWID", SWID, domain=".espn.com")
s.cookies.set("espn_s2", ESPN_S2, domain=".espn.com")
s.headers["User-Agent"] = "fantasy-hq-debug/1.0"


def get(url, params=None, headers=None):
    r = s.get(url, params=params, headers=headers, timeout=30)
    print("GET", r.url, "->", r.status_code)
    return r


# 1) authoritative proTeamId -> abbreviation, from the fantasy API's own namespace
r = get(f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{SEASON}",
        params={"view": "proTeamSchedules"})
if r.status_code == 200:
    teams = r.json().get("settings", {}).get("proTeamSchedules") or r.json().get("settings", {}).get("proTeams", [])
    print(f"proTeams entries: {len(teams) if isinstance(teams, list) else 'n/a'}")
    print("sample:", json.dumps(teams[:3] if isinstance(teams, list) else teams, indent=2)[:800])
else:
    print("body:", r.text[:400])

# 2) manual dot-product check for a QB, K, DST in the reported-off league
base = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{SEASON}/segments/0/leagues"
d = get(f"{base}/{LEAGUE_ID}", params={"view": ["mSettings", "mTeam", "mRoster", "mStatus"]}).json()
items = d.get("settings", {}).get("scoringSettings", {}).get("scoringItems", [])
by_stat = {}
for it in items:
    by_stat[it["statId"]] = it

swid = SWID.strip("{}").lower()
mine = next(t for t in d["teams"] if swid in [str(o).strip("{}").lower() for o in (t.get("owners") or [])])
entries = mine["roster"]["entries"]

for e in entries:
    p = e["playerPoolEntry"]["player"]
    pos_id = p.get("defaultPositionId")
    if pos_id not in (1, 5, 16):  # QB, K, D/ST
        continue
    print(f"\n-- {p.get('fullName')} pos={pos_id} proTeamId={p.get('proTeamId')} --")
    stats = p.get("stats", [])
    proj = next((st for st in stats if st.get("statSourceId") == 1 and st.get("scoringPeriodId") == WEEK
                 and st.get("seasonId") == SEASON), None)
    if not proj:
        print("  no current-week projection entry found")
        continue
    print("  appliedTotal (ESPN's number):", proj.get("appliedTotal"))
    raw = proj.get("stats", {})
    manual = 0.0
    contribs = []
    for stat_id_str, val in raw.items():
        stat_id = int(stat_id_str)
        item = by_stat.get(stat_id)
        if not item:
            continue
        overrides = item.get("pointsOverrides") or {}
        pts = overrides.get(str(pos_id), item.get("points", 0))
        if pts:
            manual += val * pts
            contribs.append((stat_id, val, pts, val * pts))
    print("  manual dot-product using this league's scoringItems:", round(manual, 4))
    contribs.sort(key=lambda x: -abs(x[3]))
    for c in contribs[:12]:
        print("    statId", c[0], "raw", round(c[1], 4), "x weight", c[2], "=", round(c[3], 4))
