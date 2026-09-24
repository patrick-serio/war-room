#!/usr/bin/env python3
"""Fetch a Sleeper user's NFL leagues and write one compact JSON file for the site.

Runs inside GitHub Actions (which can reach Sleeper). Endpoints:
  documented:   https://api.sleeper.app/v1/...
  undocumented: https://api.sleeper.com/projections/... and /stats/...  (widely used)

Anything optional that fails is recorded in `notes` and the site degrades
instead of the whole run failing.
"""
import datetime as dt
import json
import os
import sys
import time

import requests

API = os.environ.get("SLEEPER_API", "https://api.sleeper.app/v1").rstrip("/")
PROJ_API = os.environ.get("SLEEPER_PROJ_API", "https://api.sleeper.com").rstrip("/")
USERNAME = os.environ.get("SLEEPER_USERNAME", "PatrickSerio")
OUT = os.environ.get("OUT_PATH", "site/data/leagues.json")
POS = ["QB", "RB", "WR", "TE", "K", "DEF"]

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "fantasy-hq/1.0 (personal use)"
NOTES = []


def http_get(url, params=None, timeout=60, tries=4):
    last = None
    for i in range(tries):
        try:
            r = SESSION.get(url, params=params, timeout=timeout)
        except requests.RequestException as e:
            last = str(e)
            time.sleep(min(2 ** i, 8))
            continue
        if r.status_code == 200:
            return r.json()
        last = f"HTTP {r.status_code}"
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(min(2 ** i, 8))
            continue
        break
    raise RuntimeError(f"GET {url} failed: {last}")


def num(x):
    try:
        v = float(x)
        return v
    except (TypeError, ValueError):
        return None


def r2(x):
    # Keep Sleeper's own precision here so the site sums full-precision numbers
    # and rounds once for display, instead of compounding per-player rounding.
    return None if x is None else round(x, 2)


def pos_params(extra):
    return [("season_type", "regular")] + [("position[]", p) for p in POS] + extra


def score_from_stats(stats, scoring_settings):
    """Dot-product a player's raw projected/actual stats against a league's own
    scoring_settings. This is what Sleeper's app itself does; their public
    projections endpoint's canned pts_ppr/pts_half_ppr/pts_std buckets assume
    generic default scoring and can be meaningfully off for a league with any
    custom weights (different INT penalty, yardage bonuses, etc)."""
    if not stats or not scoring_settings:
        return 0.0
    return sum((stats.get(k) or 0) * w for k, w in scoring_settings.items() if isinstance(w, (int, float)))


def raw_stats(st, stat_keys):
    """Keep only the numeric stat fields any of the user's leagues actually score,
    dropping metadata (adp, games-played, etc) and zero values to stay compact."""
    out = {}
    for k in stat_keys:
        v = num(st.get(k))
        if v:
            out[k] = r2(v)
    return out


def fetch_projections(season, week, stat_keys):
    """pid -> {opp, tm, st}"""
    data = http_get(f"{PROJ_API}/projections/nfl/{season}/{week}",
                    params=pos_params([("order_by", "pts_ppr")]))
    out = {}
    for it in data:
        pid = str(it.get("player_id", ""))
        st = it.get("stats") or {}
        if not pid or not st:
            continue
        out[pid] = {
            "opp": it.get("opponent"),
            "tm": it.get("team"),
            "st": raw_stats(st, stat_keys),
        }
    return out


def fetch_recent(season, week, stat_keys, lookback=4):
    """pid -> list of weekly dicts, oldest first, only weeks the player has stats."""
    per = {}
    for wk in range(max(1, week - lookback), week):
        try:
            data = http_get(f"{PROJ_API}/stats/nfl/{season}/{wk}",
                            params=pos_params([("order_by", "pts_ppr")]))
        except RuntimeError as e:
            NOTES.append(f"Week {wk} stats unavailable ({e})")
            continue
        for it in data:
            pid = str(it.get("player_id", ""))
            st = it.get("stats") or {}
            if not pid or not st:
                continue
            rush = num(st.get("rush_att")) or 0
            rec = num(st.get("rec")) or 0
            per.setdefault(pid, []).append({
                "st": raw_stats(st, stat_keys),
                "tgt": num(st.get("rec_tgt")) or 0,
                "tch": rush + rec,
            })
    return per


def age_of(p):
    if p.get("age"):
        return int(p["age"])
    bd = p.get("birth_date")
    if bd:
        try:
            d = dt.date.fromisoformat(bd)
            return int((dt.date.today() - d).days / 365.25)
        except ValueError:
            return None
    return None


def build_player(pid, base, proj, recent):
    pos = base.get("position")
    if pos == "DEF":
        name, tm = f"{pid} D/ST", pid
    else:
        name = f"{base.get('first_name', '')} {base.get('last_name', '')}".strip() or pid
        tm = base.get("team")
    rank = base.get("search_rank")
    r, tgt, tch = [], [], []
    for w in (recent or [])[-4:]:
        r.append(w["st"])
        tgt.append(w["tgt"])
        tch.append(w["tch"])
    p = proj or {}
    return {
        "n": name, "pos": pos, "tm": tm, "age": age_of(base),
        "inj": base.get("injury_status"),
        "rank": rank if isinstance(rank, int) and rank < 900000 else None,
        "opp": p.get("opp"),
        "p": p.get("st") if proj else None,
        "r": r, "tgt": tgt, "tch": tch,
    }


def build_picks(league, teams, season, traded):
    """Future draft picks per roster id for dynasty/keeper leagues."""
    rounds = int((league.get("settings") or {}).get("draft_rounds") or 4)
    owner = {}
    seasons = [str(int(season) + 1), str(int(season) + 2)]
    for t in teams:
        for s in seasons:
            for rd in range(1, rounds + 1):
                owner[(s, rd, t["roster_id"])] = t["roster_id"]
    for tp in traded or []:
        key = (str(tp.get("season")), int(tp.get("round", 0)), tp.get("roster_id"))
        if key in owner or str(tp.get("season")) in seasons:
            owner[key] = tp.get("owner_id")
    picks = {t["roster_id"]: [] for t in teams}
    for (s, rd, orig), own in owner.items():
        if own in picks:
            picks[own].append({"s": s, "rd": rd, "from": orig})
    for v in picks.values():
        v.sort(key=lambda x: (x["s"], x["rd"], x["from"]))
    return picks


def build_league(lg, user_id, week, players_db, detail):
    lid = lg["league_id"]
    if detail is None:
        raise RuntimeError(f"{lg.get('name')}: league detail unavailable")
    rosters = http_get(f"{API}/league/{lid}/rosters") or []
    users = http_get(f"{API}/league/{lid}/users") or []
    try:
        traded = http_get(f"{API}/league/{lid}/traded_picks")
    except RuntimeError as e:
        traded = []
        NOTES.append(f"{lg.get('name')}: traded picks unavailable ({e})")
    try:
        matchups = http_get(f"{API}/league/{lid}/matchups/{max(1, week)}") or []
    except RuntimeError:
        matchups = []

    st = detail.get("settings") or {}
    sc = detail.get("scoring_settings") or {}
    rec = sc.get("rec", 0) or 0
    scoring = "ppr" if rec >= 1 else ("half" if rec >= 0.5 else "std")
    ltype = int(st.get("type") or 0)
    fmt = {2: "dynasty", 1: "keeper"}.get(ltype, "redraft")
    by_user = {u["user_id"]: u for u in users}

    teams, me = [], None
    for r in rosters:
        u = by_user.get(r.get("owner_id"), {})
        team_name = (u.get("metadata") or {}).get("team_name") or u.get("display_name") or f"Team {r['roster_id']}"
        s = r.get("settings") or {}
        t = {
            "roster_id": r["roster_id"],
            "name": team_name,
            "owner": u.get("display_name"),
            "w": s.get("wins", 0), "l": s.get("losses", 0), "t": s.get("ties", 0),
            "players": [str(x) for x in (r.get("players") or [])],
            # keep "0" (empty slot) so starters[i] stays aligned with roster_positions
            "starters": [str(x) for x in (r.get("starters") or [])],
            "reserve": [str(x) for x in (r.get("reserve") or [])],
            "taxi": [str(x) for x in (r.get("taxi") or [])],
        }
        teams.append(t)
        if r.get("owner_id") == user_id or user_id in (r.get("co_owners") or []):
            me = r["roster_id"]
    if me is None:
        raise RuntimeError(f"{lg.get('name')}: could not find your roster")

    if fmt != "redraft":
        picks = build_picks(detail, teams, detail.get("season") or lg.get("season"), traded)
        for t in teams:
            t["picks"] = picks.get(t["roster_id"], [])

    opp = None
    mine = next((m for m in matchups if m.get("roster_id") == me), None)
    if mine and mine.get("matchup_id") is not None:
        other = [m for m in matchups if m.get("matchup_id") == mine["matchup_id"] and m.get("roster_id") != me]
        if other:
            opp = other[0]["roster_id"]

    return {
        "id": str(lid), "platform": "sleeper", "name": detail.get("name") or lg.get("name"),
        "format": fmt, "scoring": scoring, "scoring_settings": sc,
        "slots": detail.get("roster_positions") or [],
        "ir_slots": int(st.get("reserve_slots") or 0),
        "taxi_slots": int(st.get("taxi_slots") or 0),
        "me": me, "opp": opp, "teams": teams,
    }


def main():
    user = http_get(f"{API}/user/{USERNAME}")
    if not user or not user.get("user_id"):
        sys.exit(f"Sleeper user {USERNAME!r} not found")
    uid = user["user_id"]

    state = http_get(f"{API}/state/nfl")
    season = str(state.get("season"))
    week = int(state.get("week") or 0)
    stype = state.get("season_type", "regular")
    pweek = max(1, week)
    if stype != "regular":
        NOTES.append(f"NFL season state is '{stype}', projections may be empty")

    leagues_raw = http_get(f"{API}/user/{uid}/leagues/nfl/{season}") or []
    if not leagues_raw:
        NOTES.append(f"No NFL leagues found for {USERNAME} in {season}")

    players_db = http_get(f"{API}/players/nfl", timeout=180)

    details = {}
    for lg in leagues_raw:
        try:
            details[lg["league_id"]] = http_get(f"{API}/league/{lg['league_id']}")
        except RuntimeError as e:
            NOTES.append(f"{lg.get('name')}: league detail unavailable ({e})")

    # Only keep stat fields at least one of the user's leagues actually scores.
    stat_keys = set()
    for d in details.values():
        stat_keys |= set((d.get("scoring_settings") or {}).keys())

    proj = {}
    try:
        proj = fetch_projections(season, pweek, stat_keys)
        if not proj:
            NOTES.append("Projections came back empty; lineup advice will use recent form only")
    except RuntimeError as e:
        NOTES.append(f"Projections unavailable ({e}); lineup advice will use recent form only")
    recent = fetch_recent(season, pweek, stat_keys)
    if not recent and pweek > 1:
        NOTES.append("Recent-form stats unavailable; form and usage trends are hidden")

    trending = []
    try:
        tr = http_get(f"{API}/players/nfl/trending/add", params={"lookback_hours": 48, "limit": 40})
        trending = [str(x["player_id"]) for x in tr]
    except RuntimeError as e:
        NOTES.append(f"Trending adds unavailable ({e})")

    leagues = []
    for lg in leagues_raw:
        try:
            leagues.append(build_league(lg, uid, week, players_db, details.get(lg["league_id"])))
        except RuntimeError as e:
            NOTES.append(str(e))

    quotas = {"RB": 30, "WR": 30, "TE": 14, "QB": 10, "K": 6, "DEF": 8}
    needed = set()
    for lg in leagues:
        # Free-agent pool: unrostered players ranked by this league's own scoring
        # (projection, or recent form when there's no projection for them).
        ss = lg["scoring_settings"]

        def form(pid, ss=ss):
            v = (recent.get(pid) or [])[-3:]
            vals = [score_from_stats(w["st"], ss) for w in v]
            return sum(vals) / len(vals) if vals else 0.0

        def strength(pid, ss=ss):
            pr = score_from_stats((proj.get(pid) or {}).get("st"), ss)
            return max(pr, form(pid, ss))

        rostered = {p for t in lg["teams"] for p in t["players"] + t["reserve"] + t["taxi"]}
        pool, counts = [], {k: 0 for k in quotas}
        cands = sorted(set(proj) | set(recent) | set(trending), key=lambda x: -strength(x))
        for pid in cands:
            base = players_db.get(pid)
            if not base or pid in rostered:
                continue
            pos = base.get("position")
            if pos not in quotas:
                continue
            if counts[pos] < quotas[pos] or pid in trending:
                if base.get("status") == "Inactive" and pos != "DEF" and pid not in proj:
                    continue
                counts[pos] += 1
                pool.append(pid)
        lg["free_agents"] = pool
        needed |= set(pool) | rostered

    players = {}
    for pid in needed:
        base = players_db.get(pid)
        if not base or base.get("position") not in POS:
            continue
        players[pid] = build_player(pid, base, proj.get(pid), recent.get(pid))

    missing = {p for lg in leagues for t in lg["teams"] for p in t["players"]} - set(players)
    if missing:
        NOTES.append(f"{len(missing)} rostered players not in Sleeper's player list (skipped)")

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "username": USERNAME, "season": season, "week": week, "season_type": stype,
        "notes": NOTES,
        "trending": [t for t in trending if t in players],
        "players": players, "leagues": leagues,
    }
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(leagues)} leagues, {len(players)} players, {len(NOTES)} notes")
    for n in NOTES:
        print("NOTE:", n)


if __name__ == "__main__":
    main()
