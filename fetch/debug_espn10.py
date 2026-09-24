"""Temporary diagnostic: verify ESPN_KEEPER_OVERRIDES actually applies --
Chase should now show kprd=1 (from the override), and valueOf() in
logic.js should discount him by the round-1 PICK_VALUE cost."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402


def main():
    import requests
    state = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=30).json()
    season, week = int(state.get("season")), int(state.get("week") or 0)
    notes = []
    leagues, players = espn.fetch(["610033022", "43688494"], season, week, notes)
    print(f"notes: {notes}")

    # BUG CAUGHT: a loose "Chase" in name substring match previously matched
    # Chase McLaughlin (a kicker), not Ja'Marr Chase (WR, CIN). Re-find him
    # properly by exact full name + position + team this time.
    real_chase = [(pid, p) for pid, p in players.items()
                  if pid.startswith("espn:610033022:") and p.get("n") == "Ja'Marr Chase"]
    print(f"players named exactly 'Ja'Marr Chase' on Belichicks Receivers: {len(real_chase)}")
    for pid, p in real_chase:
        print(f"  {pid} -> {json.dumps(p)}")

    wrong_one = players.get("espn:610033022:3150744")
    print(f"\nespn:610033022:3150744 (the id I'd been using) is actually: {json.dumps(wrong_one)}")


if __name__ == "__main__":
    main()
