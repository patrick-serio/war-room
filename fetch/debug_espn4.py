"""Temporary diagnostic: check Blake Corum's projection across the deployed
site, a fresh espn.fetch() call, and ESPN's raw stats[] array, to determine
whether the ~0.4 point gap (8.6 deployed vs 8.98 on ESPN) is genuine live
drift or a latent bug (e.g. still-stale deploy, rounding, or another
collision path the per-league pid fix didn't cover)."""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LIVE_URL = "https://patrick-serio.github.io/war-room/data/leagues.json"
LEAGUE_IDS = ["610033022", "43688494"]


def main():
    req = urllib.request.Request(LIVE_URL, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as r:
        live = json.loads(r.read())
    print(f"deployed generated_at: {live.get('generated_at')}")

    for pid, p in live.get("players", {}).items():
        if "Corum" in p.get("n", ""):
            print(f"LIVE DEPLOYED: {pid} -> {json.dumps(p)}")

    import requests
    state = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=30).json()
    season, week = int(state.get("season")), int(state.get("week") or 0)
    print(f"\nstate: season={season} week={week}")

    notes = []
    fresh_leagues, fresh_players = espn.fetch(LEAGUE_IDS, season, week, notes)
    print(f"notes: {notes}")
    for pid, p in fresh_players.items():
        if "Corum" in p.get("n", ""):
            print(f"FRESH via espn.fetch() (both leagues): {pid} -> {json.dumps(p)}")

    # raw stats[] dump directly from each league's roster/free-agent data
    session = espn.make_session(os.environ["ESPN_SWID"], os.environ["ESPN_S2"])
    for lid in LEAGUE_IDS:
        base = espn.league_base(session, lid, season)
        d = espn.http_get(session, f"{base}/{lid}", params={"view": ["mRoster", "mTeam"]})
        found_rostered = False
        for t in d.get("teams", []):
            for e in (t.get("roster") or {}).get("entries", []):
                p = (e.get("playerPoolEntry") or {}).get("player") or {}
                if "Corum" in p.get("fullName", ""):
                    found_rostered = True
                    stats = p.get("stats") or []
                    matches = [st for st in stats if st.get("statSourceId") == 1
                               and st.get("scoringPeriodId") == week and st.get("seasonId") == season]
                    print(f"\nleague {lid}: Blake Corum ROSTERED, {len(matches)} matching stats entries")
                    for st in matches:
                        print(f"  {json.dumps({k: st.get(k) for k in ('id', 'statSourceId', 'statSplitTypeId', 'appliedTotal')})}")
        if not found_rostered:
            filt = {"players": {"filterStatus": {"value": ["FREEAGENT", "WAIVERS"]}, "limit": 400}}
            try:
                d2 = espn.http_get(session, f"{base}/{lid}", params={"view": "kona_player_info"},
                                    headers={"x-fantasy-filter": json.dumps(filt)})
                for entry in d2.get("players", []):
                    p = entry.get("player") or entry
                    if "Corum" in p.get("fullName", ""):
                        stats = p.get("stats") or []
                        matches = [st for st in stats if st.get("statSourceId") == 1
                                   and st.get("scoringPeriodId") == week and st.get("seasonId") == season]
                        print(f"\nleague {lid}: Blake Corum FREE AGENT, {len(matches)} matching stats entries")
                        for st in matches:
                            print(f"  {json.dumps({k: st.get(k) for k in ('id', 'statSourceId', 'statSplitTypeId', 'appliedTotal')})}")
            except Exception as e:
                print(f"league {lid} free-agent check failed: {e}")


if __name__ == "__main__":
    main()
