#!/usr/bin/env python3
"""Temporary diagnostic: print raw Sleeper data + the site's blend math for named players.
Not part of the regular pipeline. Delete after use."""
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
print("STATE", state)

user = get(f"{API}/user/{USERNAME}")
uid = user["user_id"]
leagues = get(f"{API}/user/{uid}/leagues/nfl/{season}")

players_db = get(f"{API}/players/nfl")
name_to_pid = {}
for pid, p in players_db.items():
    nm = f"{p.get('first_name','')} {p.get('last_name','')}".strip()
    name_to_pid.setdefault(nm, pid)

targets = ["Rashod Bateman", "Aaron Jones"]
for t in targets:
    matches = [(n, pid) for n, pid in name_to_pid.items() if t.lower() in n.lower()]
    print(f"NAME MATCH {t}: {matches}")

proj_params = [("season_type", "regular")] + [("position[]", p) for p in POS] + [("order_by", "pts_ppr")]
proj = get(f"{PROJ_API}/projections/nfl/{season}/{week}", params=proj_params)
proj_by_pid = {str(it.get("player_id")): it for it in proj}

for t in targets:
    matches = [pid for n, pid in name_to_pid.items() if t.lower() in n.lower()]
    for pid in matches:
        it = proj_by_pid.get(pid)
        print(f"PROJ {t} ({pid}):", json.dumps((it or {}).get("stats"), default=str))

recent = {}
for wk in range(max(1, week - 4), week):
    data = get(f"{PROJ_API}/stats/nfl/{season}/{wk}", params=proj_params)
    for it in data:
        pid = str(it.get("player_id"))
        recent.setdefault(pid, []).append((wk, it.get("stats")))

for t in targets:
    matches = [pid for n, pid in name_to_pid.items() if t.lower() in n.lower()]
    for pid in matches:
        print(f"RECENT {t} ({pid}):")
        for wk, st in recent.get(pid, []):
            print("  wk", wk, {k: st.get(k) for k in ("pts_ppr", "pts_half_ppr", "pts_std")} if st else None)

for lg in leagues:
    lid = lg["league_id"]
    detail = get(f"{API}/league/{lid}")
    rosters = get(f"{API}/league/{lid}/rosters")
    users = get(f"{API}/league/{lid}/users")
    matchups = get(f"{API}/league/{lid}/matchups/{max(1, week)}")
    sc = detail.get("scoring_settings") or {}
    rec = sc.get("rec", 0) or 0
    scoring = "ppr" if rec >= 1 else ("half" if rec >= 0.5 else "std")
    print(f"\nLEAGUE {detail.get('name')} ({lid}) rec={rec} -> scoring={scoring}")
    by_user = {u["user_id"]: u for u in users}
    me_rid = None
    for r in rosters:
        if r.get("owner_id") == uid:
            me_rid = r["roster_id"]
    mine = next((m for m in matchups if m.get("roster_id") == me_rid), None)
    opp_rid = None
    if mine and mine.get("matchup_id") is not None:
        other = [m for m in matchups if m.get("matchup_id") == mine["matchup_id"] and m.get("roster_id") != me_rid]
        if other:
            opp_rid = other[0]["roster_id"]
    print("me roster_id", me_rid, "opp roster_id", opp_rid)

    def name_of(pid):
        p = players_db.get(pid, {})
        return f"{p.get('first_name','')} {p.get('last_name','')}".strip() or pid

    for label, rid in (("ME", me_rid), ("OPP", opp_rid)):
        if rid is None:
            continue
        ros = next(r for r in rosters if r["roster_id"] == rid)
        starters = [str(x) for x in (ros.get("starters") or [])]
        print(f"{label} starters ({len(starters)}):")
        total_raw = 0.0
        total_blend = 0.0
        for pid in starters:
            if pid == "0":
                print("  <empty>")
                continue
            it = proj_by_pid.get(pid)
            pj = None
            if it and it.get("stats"):
                pj = it["stats"].get({"ppr": "pts_ppr", "half": "pts_half_ppr", "std": "pts_std"}[scoring])
            wk_vals = [st.get({"ppr": "pts_ppr", "half": "pts_half_ppr", "std": "pts_std"}[scoring])
                       for _, st in recent.get(pid, []) if st]
            wk_vals = [v for v in wk_vals[-3:] if v is not None]
            fm = sum(wk_vals) / len(wk_vals) if wk_vals else None
            if pj is not None:
                blend = 0.7 * pj + 0.3 * fm if fm is not None else pj
            else:
                blend = 0
            total_raw += pj or 0
            total_blend += blend
            print(f"  {name_of(pid):25s} pid={pid:8s} proj={pj} form3={fm} blend={round(blend,2) if blend else blend}")
        print(f"{label} TOTAL raw_proj={round(total_raw,2)} blended={round(total_blend,2)}")
