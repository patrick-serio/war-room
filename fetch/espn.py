"""Fetch the user's ESPN Fantasy Football leagues and normalize them into the
same schema build_data.py produces for Sleeper, so site/logic.js needs no
platform-specific code.

ESPN's API is undocumented and uses numeric IDs for everything. Two
simplifications versus the Sleeper integration, verified against real league
data before writing this:
  - ESPN precomputes each player's league-scored point total server-side
    (player.stats[].appliedTotal) -- confirmed exactly against this league's
    own scoringItems (raw stat value x this league's point weight, including
    the D/ST-specific overrides, sums to appliedTotal to 6+ decimal places).
    So instead of re-deriving ESPN's ~50 numeric stat IDs, each player's
    score is stored as a trivial {"pt": N} raw-stat dict with a matching
    {"pt": 1} scoring_settings, reusing logic.js's existing scoreOf() dot
    product unchanged.
  - No taxi squad or tradeable future picks (ESPN keeper leagues don't
    trade picks the way Sleeper dynasty leagues do). A league with
    draftSettings.keeperCount > 0 is tagged format "keeper" instead of
    "redraft", and each rostered player carries "kprd" (the round he
    currently occupies in this season's draft, from draftDetail.picks) --
    the round you'd forfeit next year to keep him again. logic.js's
    dynasty-style valueOf() uses that as the long-term signal for these
    leagues in place of Sleeper's age/dynasty-rank fields, which ESPN
    doesn't expose.
"""
import json
import os

import requests

HOSTS = [
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl",
    "https://fantasy.espn.com/apis/v3/games/ffl",
]
POS_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}
SLOT_MAP = {
    0: "QB", 2: "RB", 3: "WRRB_FLEX", 4: "WR", 5: "REC_FLEX", 6: "TE",
    7: "SUPER_FLEX", 16: "DEF", 17: "K", 20: "BN", 21: "IR", 23: "FLEX",
}
INJ_MAP = {
    "QUESTIONABLE": "Questionable", "DOUBTFUL": "Doubtful", "OUT": "Out",
    "INJURY_RESERVE": "IR", "SUSPENSION": "Sus",
}


def http_get(session, url, params=None, headers=None, tries=3):
    last = None
    for _ in range(tries):
        try:
            r = session.get(url, params=params, headers=headers, timeout=30)
        except requests.RequestException as e:
            last = str(e)
            continue
        if r.status_code == 200:
            return r.json()
        last = f"HTTP {r.status_code}"
    raise RuntimeError(f"GET {url} failed: {last}")


def make_session(swid, espn_s2):
    s = requests.Session()
    s.cookies.set("SWID", swid, domain=".espn.com")
    s.cookies.set("espn_s2", espn_s2, domain=".espn.com")
    s.headers["User-Agent"] = "war-room/1.0 (personal use)"
    return s


def league_base(session, league_id, season):
    for host in HOSTS:
        base = f"{host}/seasons/{season}/segments/0/leagues"
        try:
            http_get(session, f"{base}/{league_id}", params={"view": "mStatus"})
            return base
        except RuntimeError:
            continue
    return None


def week_total(stats, source, week, season):
    for st in stats or []:
        if st.get("statSourceId") == source and st.get("scoringPeriodId") == week and st.get("seasonId") == season:
            v = st.get("appliedTotal")
            return None if v is None else round(v, 2)
    return None


def fetch_pro_teams(session, season):
    """(proTeamId -> abbreviation, proTeamId -> {week: opponent abbreviation}),
    straight from the fantasy API's own namespace so it always matches
    player.proTeamId exactly, and shared across all ESPN leagues since it's
    season-scoped, not league-scoped."""
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}"
    try:
        d = http_get(session, url, params={"view": "proTeamSchedules"})
    except RuntimeError:
        return {}, {}
    teams = d.get("settings", {}).get("proTeamSchedules") or d.get("settings", {}).get("proTeams") or []
    abbrev = {t["id"]: t["abbrev"] for t in teams if "id" in t and "abbrev" in t}
    opp_by_week = {}
    for t in teams:
        tid = t.get("id")
        if tid is None:
            continue
        weekly = {}
        for wk, games in (t.get("proGamesByScoringPeriod") or {}).items():
            for g in games or []:
                home, away = g.get("homeProTeamId"), g.get("awayProTeamId")
                other = away if home == tid else home if away == tid else None
                if other is not None:
                    weekly[int(wk)] = abbrev.get(other)
                    break
        opp_by_week[tid] = weekly
    return abbrev, opp_by_week


def build_player(pid_prefix, pool_entry, week, season, pro_teams, pro_opp, draft_rounds=None):
    p = pool_entry.get("player") or pool_entry
    if not p or "id" not in p:
        return None
    pos = POS_MAP.get(p.get("defaultPositionId"))
    if not pos:
        return None
    pid = f"{pid_prefix}{p['id']}"
    stats = p.get("stats") or []
    proj = week_total(stats, 1, week, season)
    recent = []
    for wk in range(max(1, week - 4), week):
        v = week_total(stats, 0, wk, season)
        if v is not None:
            recent.append({"pt": v})
    inj = INJ_MAP.get(p.get("injuryStatus"))
    team_id = p.get("proTeamId")
    return pid, {
        "n": p.get("fullName") or pid, "pos": pos, "tm": pro_teams.get(team_id), "age": None,
        "inj": inj, "rank": None, "opp": (pro_opp.get(team_id) or {}).get(week),
        "p": {"pt": proj} if proj is not None else None,
        "r": recent, "tgt": [], "tch": [],
        "kprd": (draft_rounds or {}).get(p["id"]),
    }


def fetch_free_agents(session, base, league_id, week, season, rostered, notes, league_name, pro_teams, pro_opp):
    filt = {"players": {
        "filterStatus": {"value": ["FREEAGENT", "WAIVERS"]},
        "limit": 150,
        "sortPercOwned": {"sortPriority": 1, "sortAsc": False},
    }}
    try:
        d = http_get(session, f"{base}/{league_id}", params={"view": "kona_player_info"},
                     headers={"x-fantasy-filter": json.dumps(filt)})
    except RuntimeError as e:
        notes.append(f"{league_name}: free agents unavailable ({e})")
        return [], {}
    pool_ids, players = [], {}
    for entry in d.get("players", []):
        res = build_player(f"espn:{league_id}:", entry, week, season, pro_teams, pro_opp)
        if not res:
            continue
        pid, pdata = res
        if pid in rostered:
            continue
        players[pid] = pdata
        pool_ids.append(pid)
    return pool_ids, players


def build_league(session, league_id, season, week, notes, pro_teams, pro_opp):
    base = league_base(session, league_id, season)
    if not base:
        notes.append(f"ESPN league {league_id}: could not reach the API")
        return None, {}
    d = http_get(session, f"{base}/{league_id}",
                 params={"view": ["mSettings", "mTeam", "mRoster", "mMatchupScore", "mStatus", "mDraftDetail"]})
    league_name = d.get("settings", {}).get("name") or f"ESPN {league_id}"

    # Keeper cost: the round a rostered player currently occupies in this
    # season's draft is the round you'd forfeit next year to keep him again
    # (confirmed against the league's own draftSettings.keeperCount and
    # draftDetail.picks, which lists every pick's roundId including picks
    # auto-filled by a returning keeper). Undrafted players (picked up off
    # waivers this season) get no entry, treated as no known keeper cost.
    keeper_count = d.get("settings", {}).get("draftSettings", {}).get("keeperCount") or 0
    draft_rounds = {pk["playerId"]: pk["roundId"] for pk in d.get("draftDetail", {}).get("picks", [])
                    if pk.get("playerId") and pk.get("roundId")}
    swid = session.cookies.get("SWID", "").strip("{}").lower()
    teams_raw = d.get("teams", [])
    mine = next((t for t in teams_raw if swid in
                 [str(o).strip("{}").lower() for o in (t.get("owners") or [])]), None)
    if not mine:
        notes.append(f"{league_name}: could not find your team")
        return None, {}
    my_id = mine.get("id")

    sc = d.get("settings", {}).get("scoringSettings", {})
    items = sc.get("scoringItems", [])
    rec_pts = next((it.get("points", 0) for it in items if it.get("statId") == 53), 0)
    scoring = "ppr" if rec_pts >= 1 else ("half" if rec_pts >= 0.5 else "std")

    slot_counts = d.get("settings", {}).get("rosterSettings", {}).get("lineupSlotCounts", {})
    slots = []
    for sid, count in slot_counts.items():
        label = SLOT_MAP.get(int(sid))
        if not label or label in ("BN", "IR") or count <= 0:
            continue
        slots.extend([label] * int(count))
    slots.extend(["BN"] * int(slot_counts.get("20", 0)))

    players = {}
    teams = []
    members = d.get("members", [])
    for t in teams_raw:
        rid = t["id"]
        entries = (t.get("roster") or {}).get("entries", [])
        by_slot = {}
        active_ids, reserve_ids = [], []
        for e in entries:
            res = build_player(f"espn:{league_id}:", e.get("playerPoolEntry", {}), week, season, pro_teams, pro_opp, draft_rounds)
            if not res:
                continue
            pid, pdata = res
            players[pid] = pdata
            label = SLOT_MAP.get(e.get("lineupSlotId"))
            if label == "IR":
                reserve_ids.append(pid)
            else:
                active_ids.append(pid)
                if label and label != "BN":
                    by_slot.setdefault(label, []).append(pid)
        starters = []
        for s in slots:
            if s == "BN":
                continue
            bucket = by_slot.get(s, [])
            starters.append(bucket.pop(0) if bucket else "0")
        rec = t.get("record", {}).get("overall", {})
        oids = [str(o).strip("{}").lower() for o in (t.get("owners") or [])]
        om = next((m for m in members if str(m.get("id", "")).strip("{}").lower() in oids), None)
        owner = f"{om.get('firstName','')} {om.get('lastName','')}".strip() if om else None
        teams.append({
            "roster_id": rid,
            "name": t.get("name") or f"Team {rid}",
            "owner": owner,
            "w": rec.get("wins", 0), "l": rec.get("losses", 0), "t": rec.get("ties", 0),
            "players": active_ids + reserve_ids,
            "starters": starters,
            "reserve": reserve_ids,
            "taxi": [],
        })

    opp = None
    cur_mp = d.get("status", {}).get("currentMatchupPeriod")
    for m in d.get("schedule", []):
        if m.get("matchupPeriodId") != cur_mp:
            continue
        home, away = m.get("home", {}), m.get("away", {})
        if home.get("teamId") == my_id:
            opp = away.get("teamId")
            break
        if away.get("teamId") == my_id:
            opp = home.get("teamId")
            break

    rostered = set(players)
    fa_ids, fa_players = fetch_free_agents(session, base, league_id, week, season, rostered, notes, league_name, pro_teams, pro_opp)
    players.update(fa_players)

    league = {
        "id": f"espn:{league_id}", "platform": "espn", "name": league_name,
        "format": "keeper" if keeper_count > 0 else "redraft", "keepers": keeper_count,
        "scoring": scoring, "scoring_settings": {"pt": 1},
        "slots": slots,
        "ir_slots": int(slot_counts.get("21", 0)),
        "taxi_slots": 0,
        "me": my_id, "opp": opp, "teams": teams, "free_agents": fa_ids,
    }
    return league, players


def fetch(league_ids, season, week, notes):
    """Returns (leagues, players) in the same shape build_data.py produces."""
    swid, espn_s2 = os.environ.get("ESPN_SWID"), os.environ.get("ESPN_S2")
    if not swid or not espn_s2 or not league_ids:
        return [], {}
    session = make_session(swid, espn_s2)
    pro_teams, pro_opp = fetch_pro_teams(session, season)
    leagues, players = [], {}
    for lid in league_ids:
        try:
            lg, lg_players = build_league(session, lid, season, week, notes, pro_teams, pro_opp)
        except Exception as e:  # noqa: BLE001 -- one bad ESPN league shouldn't sink the whole run
            notes.append(f"ESPN league {lid}: {e}")
            continue
        if lg:
            leagues.append(lg)
            players.update(lg_players)
    return leagues, players
