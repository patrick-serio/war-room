#!/usr/bin/env python3
"""Temporary diagnostic #5: smoke-test the tm/team-abbreviation fix against
the real leagues. Not for permanent use -- delete after use."""
import sys

sys.path.insert(0, "fetch")
import espn  # noqa: E402

LEAGUE_IDS = ["610033022", "43688494"]
SEASON = 2026
WEEK = 3

notes = []
leagues, players = espn.fetch(LEAGUE_IDS, SEASON, WEEK, notes)
print(f"leagues: {len(leagues)}, players: {len(players)}, notes: {notes}")

no_team = [p for p in players.values() if not p.get("tm")]
print(f"players with no team resolved: {len(no_team)} / {len(players)}")
for p in no_team[:10]:
    print("  MISSING TM:", p["n"], p["pos"])

for lg in leagues:
    me = next(t for t in lg["teams"] if t["roster_id"] == lg["me"])
    print(f"\n=== {lg['name']} ({lg['id']}) my roster with tm ===")
    for pid in me["starters"]:
        if pid == "0":
            continue
        p = players.get(pid)
        if p:
            print(f"  {p['n']:25s} {p['pos']:4s} tm={p['tm']}")
