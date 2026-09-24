"""Temporary diagnostic: fetch the ACTUAL deployed site/data/leagues.json
from the live GitHub Pages URL and inspect exactly what's being served for
the players the user says are still wrong, plus re-derive the same values
via the production code path (espn.fetch(), not hand-rolled calls) for
comparison, since the user says a fresh private-browser pull-to-refresh
still shows stale numbers -- ruling out browser/tab caching entirely."""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LIVE_URL = "https://patrick-serio.github.io/war-room/data/leagues.json"
NAMES = ["Josh Allen", "Fairbairn"]


def main():
    print(f"Fetching live deployed data: {LIVE_URL}")
    req = urllib.request.Request(LIVE_URL, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as r:
        live = json.loads(r.read())

    print(f"generated_at / fetched_at fields: { {k: v for k, v in live.items() if 'at' in k.lower() or 'time' in k.lower()} }")
    print(f"notes: {live.get('notes')}")

    leagues = live.get("leagues", [])
    print(f"\ntotal leagues in live payload: {len(leagues)}")
    for lg in leagues:
        print(f"  - {lg.get('id')} / {lg.get('name')} / platform={lg.get('platform')} / scoring_settings={lg.get('scoring_settings')}")

    br = next((l for l in leagues if "610033022" in str(l.get("id"))), None)
    if not br:
        print("Belichicks Receivers league NOT FOUND in live payload")
        return
    print(f"\nBelichicks Receivers found: id={br['id']} scoring_settings={br['scoring_settings']}")

    players = live.get("players", {})
    print(f"total players in live payload: {len(players)}")

    for pid, p in players.items():
        nm = p.get("n", "")
        if any(n.lower() in nm.lower() for n in NAMES) and p.get("tm") in (None, "BUF", "HOU"):
            print(f"\nLIVE DEPLOYED: {pid} -> {json.dumps(p)}")

    # find Rams D/ST specifically (posId 16 DEF on Rams)
    for pid, p in players.items():
        if p.get("pos") == "DEF" and "Rams" in p.get("n", ""):
            print(f"\nLIVE DEPLOYED: {pid} -> {json.dumps(p)}")

    # now re-derive fresh via the REAL production entrypoint (espn.fetch), not hand-rolled calls
    print("\n--- re-deriving via espn.fetch() (the actual function build_data.py calls) ---")
    import requests
    state = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=30).json()
    season, week = int(state.get("season")), int(state.get("week") or 0)
    print(f"state: season={season} week={week}")
    notes = []
    fresh_leagues, fresh_players = espn.fetch(["610033022"], season, week, notes)
    print(f"notes from espn.fetch(): {notes}")
    for lg in fresh_leagues:
        print(f"fresh league: {lg['id']} scoring_settings={lg['scoring_settings']}")
    for pid, p in fresh_players.items():
        nm = p.get("n", "")
        if any(n.lower() in nm.lower() for n in NAMES):
            print(f"FRESH via espn.fetch(): {pid} -> {json.dumps(p)}")

    # dump the RAW stats[] array straight from the roster fetch, in case there
    # are multiple entries matching (statSourceId=1, scoringPeriodId=week,
    # seasonId=season) and week_total()'s first-match scan is order-dependent
    print("\n--- raw stats[] dump (direct roster fetch, no filtering) ---")
    session = espn.make_session(os.environ["ESPN_SWID"], os.environ["ESPN_S2"])
    base = espn.league_base(session, "610033022", season)
    d = espn.http_get(session, f"{base}/610033022", params={"view": ["mRoster", "mTeam"]})
    for t in d.get("teams", []):
        for e in (t.get("roster") or {}).get("entries", []):
            p = (e.get("playerPoolEntry") or {}).get("player") or {}
            if "Allen" not in p.get("fullName", ""):
                continue
            stats = p.get("stats") or []
            matches = [st for st in stats if st.get("statSourceId") == 1
                       and st.get("scoringPeriodId") == week and st.get("seasonId") == season]
            print(f"{p.get('fullName')}: {len(matches)} entries match (source=1,week={week},season={season})")
            for st in matches:
                print(f"  {json.dumps({k: st.get(k) for k in ('id', 'statSourceId', 'statSplitTypeId', 'scoringPeriodId', 'seasonId', 'appliedTotal')})}")

    # THEORY: the same player id gets fetched across BOTH ESPN leagues
    # (rostered in one, free-agent in the other), and since players.update()
    # in espn.fetch() shares one flat pid namespace across leagues, whichever
    # league is processed LAST in ESPN_LEAGUE_IDS order clobbers the other
    # league's correctly-scoped {"pt": N} value for that shared player id --
    # explaining why only Belichicks Receivers (processed first) shows wrong
    # numbers while Cod Squad (processed last) is fine, and why it's
    # specifically QB/K/DST (positions most likely to be free agents in
    # both leagues at once).
    print("\n--- cross-league collision check: does Josh Allen appear in Cod Squad (43688494) too? ---")
    base2 = espn.league_base(session, "43688494", season)
    filt = {"players": {"filterStatus": {"value": ["FREEAGENT", "WAIVERS"]}, "limit": 400}}
    try:
        d2 = espn.http_get(session, f"{base2}/43688494", params={"view": "kona_player_info"},
                            headers={"x-fantasy-filter": json.dumps(filt)})
        hits = 0
        for entry in d2.get("players", []):
            p = entry.get("player") or entry
            if p.get("id") == 3918298:
                hits += 1
                stats = p.get("stats") or []
                m = [st for st in stats if st.get("statSourceId") == 1
                     and st.get("scoringPeriodId") == week and st.get("seasonId") == season]
                print(f"Josh Allen found in Cod Squad free agents! matching entries: {len(m)}")
                for st in m:
                    print(f"  {json.dumps({k: st.get(k) for k in ('id', 'statSourceId', 'appliedTotal')})}")
        if not hits:
            print("Josh Allen NOT found in Cod Squad free-agent pool")
    except Exception as e:
        print(f"Cod Squad free-agent check failed: {e}")

    both_leagues, both_players = espn.fetch(["610033022", "43688494"], season, week, notes)
    br_key = "espn:610033022:3918298"
    cod_key = "espn:43688494:3918298"
    print(f"\nespn.fetch() with BOTH league ids in production order (post-fix, league-scoped pids):")
    print(f"  Belichicks Receivers Josh Allen ({br_key}) -> {json.dumps(both_players.get(br_key))}")
    print(f"  Cod Squad Josh Allen ({cod_key}) -> {json.dumps(both_players.get(cod_key))}")


if __name__ == "__main__":
    main()
