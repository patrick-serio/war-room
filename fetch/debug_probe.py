#!/usr/bin/env python3
"""Temporary diagnostic: check whether the league has custom scoring_settings
beyond generic std/half/ppr, and whether computing a player's score directly
from projected per-stat values x scoring_settings gets closer to what Sleeper
shows than the canned pts_half_ppr bucket does. Not for permanent use."""
import json
import os

import requests

API = "https://api.sleeper.app/v1"
PROJ_API = "https://api.sleeper.com"
USERNAME = os.environ.get("SLEEPER_USERNAME", "PatrickSerio")
POS = ["QB", "RB", "WR", "TE", "K", "DEF"]

s = requests.Session()
s.headers["User-Agent"] = "fantasy-hq-debug/1.0"


def get(url, params=None):
    r = s.get(url, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


state = get(f"{API}/state/nfl")
season, week = str(state["season"]), int(state["week"])

user = get(f"{API}/user/{USERNAME}")
uid = user["user_id"]
leagues = get(f"{API}/user/{uid}/leagues/nfl/{season}")

target_pid = "4984"  # Josh Allen, Bills QB (confirmed from an earlier matchup dump; Sleeper also has a Josh Allen LB)
print("Josh Allen pid:", target_pid)

proj_params = [("season_type", "regular")] + [("position[]", p) for p in POS] + [("order_by", "pts_ppr")]
proj = get(f"{PROJ_API}/projections/nfl/{season}/{week}", params=proj_params)
proj_by_pid = {str(it.get("player_id")): it for it in proj}
allen = proj_by_pid.get(target_pid, {})
print("Allen raw projection entry:")
print(json.dumps(allen, indent=2, default=str))

for lg in leagues:
    lid = lg["league_id"]
    detail = get(f"{API}/league/{lid}")
    sc = detail.get("scoring_settings") or {}
    print(f"\nLEAGUE {detail.get('name')} ({lid}) full scoring_settings:")
    print(json.dumps(sc, indent=2, sort_keys=True))

    stats = allen.get("stats") or {}
    computed = sum(stats.get(k, 0) * v for k, v in sc.items() if isinstance(v, (int, float)))
    print(f"\nCanned pts_half_ppr for Allen: {stats.get('pts_half_ppr')}")
    print(f"Canned pts_ppr for Allen:      {stats.get('pts_ppr')}")
    print(f"Canned pts_std for Allen:      {stats.get('pts_std')}")
    print(f"Computed from stats x league scoring_settings: {round(computed, 2)}")

    # show which scoring_settings keys actually matched a nonzero stat, to see what's driving it
    contribs = [(k, stats.get(k, 0), v, round(stats.get(k, 0) * v, 2)) for k, v in sc.items()
                if isinstance(v, (int, float)) and stats.get(k, 0)]
    contribs.sort(key=lambda x: -abs(x[3]))
    print("Top contributing stat x weight:")
    for k, sv, w, contrib in contribs[:15]:
        print(f"  {k:20s} stat={sv:<8} weight={w:<6} contrib={contrib}")
