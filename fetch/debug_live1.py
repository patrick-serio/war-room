"""Temporary diagnostic: confirm the current-week "live" stats pipeline
actually pulls real in-progress/completed-game data from Sleeper and ESPN,
not just the mock server. Deleted after verification."""
import json

d = json.load(open("site/data/leagues.json"))
print("week:", d.get("week"), "season_type:", d.get("season_type"))

players = d["players"]
live_players = {pid: p for pid, p in players.items() if p.get("live")}
print(f"\n{len(live_players)} / {len(players)} players have live stats this week")

by_league_platform = {}
for lg in d["leagues"]:
    plat = lg["platform"]
    rostered = {p for t in lg["teams"] for p in t["players"]}
    locked_rostered = [p for p in rostered if players.get(p, {}).get("live")]
    print(f"\nLeague: {lg['name']} ({plat}) -- {len(locked_rostered)} / {len(rostered)} rostered players locked")
    for pid in locked_rostered[:8]:
        p = players[pid]
        print(f"   {p['n']:25s} {p['pos']:4s} live={p['live']}  proj_stats={p.get('p')}")

if not live_players:
    print("\nNOTE: nobody has live stats yet -- either no games in this NFL week have")
    print("started/finished, or the live-stat fetch is broken. Check the week/day.")
