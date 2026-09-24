"""Temporary diagnostic: check keeperCount for both ESPN leagues, to decide
whether keeper-cost trade valuation should apply to just Belichicks
Receivers or both leagues."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LEAGUE_IDS = ["610033022", "43688494"]


def main():
    session = espn.make_session(os.environ["ESPN_SWID"], os.environ["ESPN_S2"])
    for lid in LEAGUE_IDS:
        base = espn.league_base(session, lid, 2026)
        d = espn.http_get(session, f"{base}/{lid}", params={"view": "mSettings"})
        fs = d.get("settings", {}).get("financeSettings", {})
        name = d.get("settings", {}).get("name")
        print(f"{lid} ({name}): keeperCount={fs.get('keeperCount')} keeperCountFuture={fs.get('keeperCountFuture')}")


if __name__ == "__main__":
    main()
