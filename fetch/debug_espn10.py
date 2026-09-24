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
    chase = players.get("espn:610033022:3150744")
    print(f"Chase: {json.dumps(chase)}")
    assert chase and chase.get("kprd") == 1, f"expected kprd=1, got {chase.get('kprd') if chase else 'MISSING'}"
    print("OK: override applied correctly")


if __name__ == "__main__":
    main()
