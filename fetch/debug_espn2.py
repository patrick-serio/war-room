"""Temporary diagnostic: dump every stats[] entry (not just the one
week_total() picks) for a few players the user reports as stale, to find
out whether ESPN's stats array carries multiple entries that collide on
(statSourceId, scoringPeriodId, seasonId) -- which would make week_total()'s
first-match linear scan pick the wrong, stale one."""
import json
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LEAGUE_ID = "610033022"  # Belichicks Receivers
NAMES = ["Josh Allen", "Ka'imi Fairbairn", "Fairbairn"]
DEF_TEAM_ID_GUESS = None  # will print all DEF entries instead


def dump_player(p, week, season):
    print(f"\n=== {p.get('fullName')} (id={p.get('id')}, posId={p.get('defaultPositionId')}, proTeamId={p.get('proTeamId')}) ===")
    stats = p.get("stats") or []
    print(f"total stats[] entries: {len(stats)}")
    for st in stats:
        if st.get("scoringPeriodId") != week:
            continue
        print(json.dumps({
            "id": st.get("id"),
            "statSourceId": st.get("statSourceId"),
            "statSplitTypeId": st.get("statSplitTypeId"),
            "scoringPeriodId": st.get("scoringPeriodId"),
            "seasonId": st.get("seasonId"),
            "appliedTotal": st.get("appliedTotal"),
            "proTeamId": st.get("proTeamId"),
        }))
    picked = espn.week_total(stats, 1, week, season)
    print(f"week_total() picks (source=1 projected): {picked}")


def main():
    swid, espn_s2 = os.environ["ESPN_SWID"], os.environ["ESPN_S2"]
    state = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=30).json()
    season = int(state.get("season"))
    week = int(state.get("week") or 0)
    print(f"Sleeper state: season={season} week={week} season_type={state.get('season_type')}")
    session = espn.make_session(swid, espn_s2)
    base = espn.league_base(session, LEAGUE_ID, season)
    print(f"base={base} season={season} week={week}")

    d = espn.http_get(session, f"{base}/{LEAGUE_ID}",
                       params={"view": ["mRoster", "mTeam"]})
    found = 0
    for t in d.get("teams", []):
        for e in (t.get("roster") or {}).get("entries", []):
            p = (e.get("playerPoolEntry") or {}).get("player") or {}
            nm = p.get("fullName", "")
            if any(n.lower() in nm.lower() for n in NAMES) or p.get("defaultPositionId") == 16:
                dump_player(p, week, season)
                found += 1

    # also pull the same player straight from free-agent / kona_player_info pool,
    # in case the roster view and player-info view disagree
    filt = {"players": {"filterSlotIds": [], "limit": 400}}
    try:
        d2 = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": "kona_player_info"},
                            headers={"x-fantasy-filter": json.dumps(filt)})
        print(f"\n--- kona_player_info pool: {len(d2.get('players', []))} players ---")
        for entry in d2.get("players", []):
            p = entry.get("player") or entry
            nm = p.get("fullName", "")
            if any(n.lower() in nm.lower() for n in NAMES):
                dump_player(p, week, season)
    except Exception as e:
        print(f"kona_player_info failed: {e}")

    print(f"\nfound {found} matching roster players")

    # verify the new opponent-mapping code against real proTeamSchedules shape
    pro_teams, pro_opp = espn.fetch_pro_teams(session, season)
    print(f"\n--- pro_teams: {len(pro_teams)} teams, pro_opp: {len(pro_opp)} teams ---")
    bills = pro_opp.get(2, {})
    print(f"Bills (id=2) opp_by_week sample: {dict(list(bills.items())[:6])}")
    texans = pro_opp.get(34, {})
    print(f"Texans (id=34) opp_by_week sample: {dict(list(texans.items())[:6])}")
    # reciprocity sanity check: if A's week-N opponent is B, B's week-N opponent should be A
    mismatches = 0
    checked = 0
    for tid, weekly in pro_opp.items():
        for wk, opp_abbrev in weekly.items():
            opp_id = next((oid for oid, ab in pro_teams.items() if ab == opp_abbrev), None)
            if opp_id is None:
                continue
            checked += 1
            back = pro_opp.get(opp_id, {}).get(wk)
            if back != pro_teams.get(tid):
                mismatches += 1
                print(f"MISMATCH: team {tid} ({pro_teams.get(tid)}) week {wk} -> {opp_abbrev}, "
                      f"but {opp_abbrev} week {wk} -> {back} (expected {pro_teams.get(tid)})")
    print(f"reciprocity check: {checked} pairs checked, {mismatches} mismatches")
    print(f"Josh Allen's team (proTeamId=2) week {week} opponent: {pro_opp.get(2, {}).get(week)}")


if __name__ == "__main__":
    main()
