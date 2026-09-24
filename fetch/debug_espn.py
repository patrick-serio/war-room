#!/usr/bin/env python3
"""Temporary diagnostic: probe ESPN's undocumented Fantasy Football API for the
user's real leagues, to discover response shapes (season/week, scoring settings,
roster/lineup slot IDs, player projection format) before writing real parsing
code. Not for permanent use -- delete after use."""
import json
import os

import requests

SWID = os.environ["ESPN_SWID"]
ESPN_S2 = os.environ["ESPN_S2"]
LEAGUE_IDS = ["610033022", "43688494"]
SEASON = os.environ.get("SEASON", "2026")

s = requests.Session()
s.cookies.set("SWID", SWID, domain=".espn.com")
s.cookies.set("espn_s2", ESPN_S2, domain=".espn.com")
s.headers["User-Agent"] = "fantasy-hq-debug/1.0"

HOSTS = [
    f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{SEASON}/segments/0/leagues",
    f"https://fantasy.espn.com/apis/v3/games/ffl/seasons/{SEASON}/segments/0/leagues",
]


def get(url, params=None, headers=None):
    r = s.get(url, params=params, headers=headers, timeout=30)
    print("GET", r.url, "->", r.status_code)
    return r


def league_base(lid):
    for h in HOSTS:
        r = get(f"{h}/{lid}", params={"view": "mSettings"})
        if r.status_code == 200:
            return h
        print("  body:", r.text[:300])
    return None


for lid in LEAGUE_IDS:
    print(f"\n===== LEAGUE {lid} =====")
    base = league_base(lid)
    if not base:
        print("Could not reach this league on any host.")
        continue

    r = get(f"{base}/{lid}", params={"view": ["mSettings", "mTeam", "mRoster", "mMatchup", "mStatus"]})
    if r.status_code != 200:
        print("BODY:", r.text[:500])
        continue
    d = r.json()
    print("top-level keys:", list(d.keys()))
    print("status:", json.dumps(d.get("status", {}), indent=2)[:600])

    settings = d.get("settings", {})
    print("league name:", settings.get("name"))
    sc = settings.get("scoringSettings", {})
    print("scoringSettings keys:", list(sc.keys()))
    print("scoringItems (first 25):", json.dumps(sc.get("scoringItems", [])[:25]))
    roster_settings = settings.get("rosterSettings", {})
    print("lineupSlotCounts:", json.dumps(roster_settings.get("lineupSlotCounts", {})))

    teams = d.get("teams", [])
    print(f"{len(teams)} teams")
    for t in teams[:4]:
        print("  team", t.get("id"), t.get("name"), t.get("location"), t.get("nickname"), "owners:", t.get("owners"))

    myswid = SWID.strip("{}").lower()
    mine = None
    for t in teams:
        owners = [str(o).strip("{}").lower() for o in (t.get("owners") or [])]
        if myswid in owners:
            mine = t
            break
    print("MY TEAM id:", mine.get("id") if mine else None)
    if mine:
        roster = (mine.get("roster") or {}).get("entries", [])
        print(f"my roster entries: {len(roster)}")
        if roster:
            print("sample entry:", json.dumps(roster[0], indent=2)[:2000])

    sched = d.get("schedule", [])
    print(f"schedule entries: {len(sched)}")
    if sched:
        print("sample matchup:", json.dumps(sched[0], indent=2)[:600])

    filt = {"players": {"filterStatus": {"value": ["FREEAGENT", "WAIVERS", "ONTEAM"]},
                         "limit": 3, "sortPercOwned": {"sortPriority": 1, "sortAsc": False}}}
    r2 = get(f"{base}/{lid}", params={"view": "kona_player_info"}, headers={"x-fantasy-filter": json.dumps(filt)})
    print("player_info status:", r2.status_code)
    if r2.status_code == 200:
        d2 = r2.json()
        players = d2.get("players", [])
        print(f"{len(players)} players returned")
        if players:
            print("sample player:", json.dumps(players[0], indent=2)[:2500])
    else:
        print("player_info body:", r2.text[:300])
