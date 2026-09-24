"""Temporary diagnostic: does ESPN's API expose keeper-related data for
Belichicks Receivers (610033022) -- e.g. draft round per player, a
"keeper" flag, or keeper-specific settings -- that could drive automatic
keeper-cost modeling in trade values, instead of requiring manual input?"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import espn  # noqa: E402

LEAGUE_ID = "610033022"


def main():
    swid, espn_s2 = os.environ["ESPN_SWID"], os.environ["ESPN_S2"]
    session = espn.make_session(swid, espn_s2)
    season = 2026
    base = espn.league_base(session, LEAGUE_ID, season)

    # 1) league settings -- look for anything keeper-related
    d = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": "mSettings"})
    settings = d.get("settings", {})
    print("--- settings top-level keys ---")
    print(list(settings.keys()))
    roster_settings = settings.get("rosterSettings", {})
    print("\n--- rosterSettings keys ---")
    print(list(roster_settings.keys()))
    for k, v in roster_settings.items():
        if "keep" in k.lower():
            print(f"KEEPER-RELATED: {k} = {v}")
    ft = settings.get("finalTradeDeadlineDate")
    print(f"\nfull settings dump (keeper search):")
    dumped = json.dumps(settings)
    if "eeper" in dumped:
        idx = dumped.find("eeper")
        print(f"found 'eeper' in settings json near: ...{dumped[max(0,idx-100):idx+200]}...")
    else:
        print("no 'keeper' substring anywhere in settings")

    # 2) draft detail -- does it expose which round each rostered player was drafted?
    print("\n--- mDraftDetail ---")
    try:
        d2 = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": "mDraftDetail"})
        draft = d2.get("draftDetail", {})
        print(f"draftDetail keys: {list(draft.keys())}")
        picks = draft.get("picks", [])
        print(f"total draft picks recorded: {len(picks)}")
        if picks:
            print(f"sample pick: {json.dumps(picks[0])}")
            # look for Ja'Marr Chase specifically if present
            for pk in picks[:5]:
                print(json.dumps(pk))
    except Exception as e:
        print(f"mDraftDetail failed: {e}")

    # 3) roster entries -- does each entry carry acquisition info (e.g. "keeper", draft round)?
    print("\n--- roster entry fields (first entry) ---")
    d3 = espn.http_get(session, f"{base}/{LEAGUE_ID}", params={"view": ["mRoster", "mTeam"]})
    teams = d3.get("teams", [])
    if teams:
        entries = (teams[0].get("roster") or {}).get("entries", [])
        if entries:
            e = entries[0]
            print(f"entry top-level keys: {list(e.keys())}")
            print(json.dumps({k: v for k, v in e.items() if k != "playerPoolEntry"}))


if __name__ == "__main__":
    main()
