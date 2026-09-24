#!/usr/bin/env python3
"""Temporary diagnostic #3: smoke-test the real fetch/espn.py module against
the user's real leagues and sanity-check the produced schema. Not for
permanent use -- delete after use."""
import json
import sys

sys.path.insert(0, "fetch")
import espn  # noqa: E402

LEAGUE_IDS = ["610033022", "43688494"]
SEASON = 2026
WEEK = 3

notes = []
leagues, players = espn.fetch(LEAGUE_IDS, SEASON, WEEK, notes)

print(f"leagues: {len(leagues)}, players: {len(players)}, notes: {notes}")

for lg in leagues:
    print(f"\n=== {lg['name']} ({lg['id']}) ===")
    print("format/scoring:", lg["format"], lg["scoring"])
    print("slots:", lg["slots"])
    print("ir_slots:", lg["ir_slots"], "free_agents:", len(lg["free_agents"]))
    print("me:", lg["me"], "opp:", lg["opp"])
    me = next(t for t in lg["teams"] if t["roster_id"] == lg["me"])
    print("my team:", me["name"], "record", me["w"], me["l"], me["t"])
    print("my players:", len(me["players"]), "starters:", me["starters"], "reserve:", me["reserve"])
    for pid in me["starters"]:
        if pid == "0":
            print("  <empty>")
            continue
        p = players.get(pid)
        print(f"  {pid} {p['n'] if p else '???'} {p['pos'] if p else ''} proj={p['p'] if p else None} inj={p['inj'] if p else None} recent={p['r'] if p else None}")
    if lg["free_agents"]:
        fa = lg["free_agents"][0]
        print("sample free agent:", fa, players.get(fa))

# quick sanity: run it through the real site logic to make sure nothing crashes
payload = {
    "generated_at": "2026-01-01T00:00:00+00:00", "username": "test", "season": str(SEASON), "week": WEEK,
    "season_type": "regular", "notes": notes, "trending": [], "players": players, "leagues": leagues,
}
with open("/tmp/espn_test.json", "w") as f:
    json.dump(payload, f)
print("\nwrote /tmp/espn_test.json")
