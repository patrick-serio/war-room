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

    filt = {"transactions": {"filterType": {"value": ["WAIVER", "FREEAGENT", "ROSTER", "DRAFT"]},
                             "sortProcessDate": {"sortPriority": 1, "sortAsc": True}, "limit": 2000}}
    print("=== mTransactions2 with broad filter ===")
    try:
        d = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": "mTransactions2"},
                           headers={"x-fantasy-filter": json.dumps(filt)})
    except Exception as e:
        print(f"failed: {e}")
        return
    txs = d.get("transactions", [])
    print(f"transactions: {len(txs)}")
    types = {}
    for t in txs:
        types[t.get("type")] = types.get(t.get("type"), 0) + 1
    print(f"type distribution: {types}")
    keeper_items = [(t, item) for t in txs for item in t.get("items", []) if item.get("isKeeper")]
    print(f"items with isKeeper=true: {len(keeper_items)}")
    for t, item in keeper_items[:5]:
        print(json.dumps({"txType": t.get("type"), "teamId": t.get("teamId"), "processDate": t.get("processDate"), "item": item}))
    chase_txs = [t for t in txs if any(item.get("playerId") == CHASE_ID for item in t.get("items", []))]
    print(f"\ntransactions mentioning Chase (id {CHASE_ID}): {len(chase_txs)}")
    for t in chase_txs:
        print(json.dumps(t))


if __name__ == "__main__":
    main()
