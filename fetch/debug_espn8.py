"""Temporary diagnostic: does ESPN expose PRIOR-season draft data for this
league, so a returning keeper's original draft round (e.g. Ja'Marr Chase,
drafted round 1 in 2025, kept into 2026 -- confirmed by the user, costing
their 2026 first-round pick) can be derived automatically instead of
needing a manual override?"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LEAGUE_ID = "610033022"
CHASE_ID = 3150744


def main():
    session = espn.make_session(os.environ["ESPN_SWID"], os.environ["ESPN_S2"])
    for season in (2025, 2024):
        print(f"\n=== season {season} ===")
        base = espn.league_base(session, LEAGUE_ID, season)
        if not base:
            print("league_base failed for this season")
            continue
        try:
            d = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": "mDraftDetail"})
        except Exception as e:
            print(f"mDraftDetail failed: {e}")
            continue
        picks = d.get("draftDetail", {}).get("picks", [])
        print(f"total picks: {len(picks)}")
        chase_picks = [pk for pk in picks if pk.get("playerId") == CHASE_ID]
        print(f"picks with playerId={CHASE_ID}: {len(chase_picks)}")
        for pk in chase_picks:
            print(json.dumps(pk))


if __name__ == "__main__":
    main()
