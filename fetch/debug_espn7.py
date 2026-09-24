"""Temporary diagnostic: verify the keeper-cost feature end to end against
real Belichicks Receivers data -- league format flips to "keeper", each
rostered player carries a sane "kprd" (draft round), and spot-check a known
player (Ja'Marr Chase, mentioned by the user as their round-1 keeper)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LEAGUE_IDS = ["610033022", "43688494"]


def main():
    import requests
    state = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=30).json()
    season, week = int(state.get("season")), int(state.get("week") or 0)
    notes = []
    leagues, players = espn.fetch(LEAGUE_IDS, season, week, notes)
    print(f"notes: {notes}")
    for lg in leagues:
        print(f"\n{lg['id']} ({lg['name']}): format={lg['format']} keepers={lg['keepers']}")

    br_players = {pid: p for pid, p in players.items() if pid.startswith("espn:610033022:")}
    with_rd = [(pid, p) for pid, p in br_players.items() if p.get("kprd") is not None]
    without_rd = [(pid, p) for pid, p in br_players.items() if p.get("kprd") is None]
    print(f"\nBelichicks Receivers: {len(br_players)} players total, {len(with_rd)} with a draft round, {len(without_rd)} without")

    # round distribution sanity check
    from collections import Counter
    rounds = Counter(p["kprd"] for _, p in with_rd)
    print(f"round distribution: {dict(sorted(rounds.items()))}")

    chase = next(((pid, p) for pid, p in br_players.items() if "Chase" in p.get("n", "")), None)
    if chase:
        pid, p = chase
        print(f"\nJa'Marr Chase: {pid} -> kprd={p.get('kprd')}, proj={p.get('p')}")
    else:
        print("\nJa'Marr Chase not found on Belichicks Receivers rosters (may not be on this team's or any roster)")

    # Cod Squad should NOT be a keeper league
    cod_players = {pid: p for pid, p in players.items() if pid.startswith("espn:43688494:")}
    cod_with_rd = sum(1 for p in cod_players.values() if p.get("kprd") is not None)
    print(f"\nCod Squad: {len(cod_players)} players, {cod_with_rd} with a draft round (kprd is harmless even if format=redraft since ctx.dyn only checks format)")


if __name__ == "__main__":
    main()
