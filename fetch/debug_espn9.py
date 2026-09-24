"""Temporary diagnostic: the user's ESPN app shows a "Latest Transaction"
entry for Ja'Marr Chase: "Selected as Keeper by Ja'Marr Marr Binks Round 1,
Pick 6" dated Aug 26 -- a keeper-selection transaction, distinct from
draftDetail.picks (which has zero entries for him this season). Find the
ESPN view/endpoint that actually carries this transaction log."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LEAGUE_ID = "610033022"
CHASE_ID = 3150744


def main():
    session = espn.make_session(os.environ["ESPN_SWID"], os.environ["ESPN_S2"])
    season = 2026
    base = espn.league_base(session, LEAGUE_ID, season)

    for view in ["mTransactions2", "mPendingTransactions", "kona_league_communication"]:
        print(f"\n=== view={view} ===")
        try:
            d = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": view})
        except Exception as e:
            print(f"failed: {e}")
            continue
        print(f"top-level keys: {list(d.keys())}")
        txs = d.get("transactions", [])
        print(f"transactions: {len(txs)}")
        chase_txs = [t for t in txs if any(
            item.get("playerId") == CHASE_ID for item in t.get("items", [])
        )]
        print(f"transactions mentioning Chase (id {CHASE_ID}): {len(chase_txs)}")
        for t in chase_txs[:3]:
            print(json.dumps(t))
        if txs and not chase_txs:
            print(f"sample transaction shape: {json.dumps(txs[0])}")


if __name__ == "__main__":
    main()
