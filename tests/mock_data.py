"""Deterministic fake Sleeper universe (fictional players) in Sleeper's response shapes.

Used to test the fetcher and the site without network access, and to build the
clearly-labelled demo league shipped with the site.
"""
import random

NFL = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
       "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"]
FIRST = ["Marcus", "Devon", "Tyrell", "Caleb", "Jaxon", "Micah", "Andre", "Omar", "Trevon", "Elijah", "Darius", "Knox",
         "Rashad", "Corey", "Brady", "Isaiah", "Malik", "Jordy", "Terrance", "Bryce", "Kendall", "Lamar", "Nolan",
         "Desmond", "Cade", "Reggie", "Silas", "Jamal", "Wes", "Tobias"]
LAST = ["Bellamy", "Okafor", "Whitlock", "Pruitt", "Delacroix", "Hargrove", "Vance", "Castellan", "Mbeki", "Strand",
        "Quill", "Ferreira", "Lockhart", "Ndiaye", "Ashby", "Crowe", "Ridley", "Tamura", "Voss", "Kessler", "Abernathy",
        "Baptiste", "Coyle", "Draper", "Ellery", "Fontaine", "Gallo", "Holloway", "Ibarra", "Jessup", "Kovac", "Lindqvist",
        "Marchetti", "Nakamura", "Oduya", "Penhall", "Quarles", "Renner", "Sandoval", "Thackery", "Underhill", "Valdez",
        "Wexler", "Yates", "Zeller", "Amsel", "Brandt", "Culpepper", "Dunmore", "Espinosa"]
COUNTS = {"QB": 42, "RB": 100, "WR": 130, "TE": 50, "K": 32}
BYE_TEAMS = {"CHI", "MIA"}
SEASON, WEEK = "2026", 3
# A realistic scoring_settings shape (matches Sleeper's own key names), so the
# fetcher's raw-stats x scoring_settings dot product has real categories to sum,
# same as a real league (each mock league adds its own "rec" rate on top).
SCORING_BASE = {
    "pass_yd": 0.04, "pass_td": 4.0, "pass_int": -2.0,
    "rush_yd": 0.1, "rush_td": 6.0,
    "rec_yd": 0.1, "rec_td": 6.0,
    "fum_lost": -2.0,
    "fgm_30_39": 3.0, "xpm": 1.0, "fgmiss": -1.0,
    "def_td": 6.0, "sack": 1.0,
    "pts_allow_0": 6.0, "pts_allow_1_6": 5.0, "pts_allow_7_13": 4.0,
    "pts_allow_14_20": 2.0, "pts_allow_21_27": 0.0,
}


def build(seed=11):
    rnd = random.Random(seed)
    names = [f"{f} {l}" for f in FIRST for l in LAST]
    rnd.shuffle(names)
    players, base = {}, {}
    nid = 1000

    def add(pos, i):
        nonlocal nid
        nid += rnd.randint(3, 40)
        pid = str(nid)
        first, last = names.pop().split(" ", 1)
        b = {"QB": 24 - i * 0.5, "RB": 20 - i * 0.2, "WR": 19 - i * 0.15, "TE": 15 - i * 0.28, "K": 9 - i * 0.1}[pos]
        b = max(b, 2.5)
        age = {"QB": rnd.randint(23, 38), "RB": rnd.randint(21, 30), "WR": rnd.randint(21, 33),
               "TE": rnd.randint(22, 34), "K": rnd.randint(24, 40)}[pos]
        players[pid] = {"first_name": first, "last_name": last, "position": pos, "team": rnd.choice(NFL),
                        "age": age, "injury_status": None, "status": "Active", "fantasy_positions": [pos],
                        "active": True}
        base[pid] = b
        return pid

    for pos, n in COUNTS.items():
        for i in range(n):
            add(pos, i)
    for tm in NFL:
        players[tm] = {"first_name": tm, "last_name": "D/ST", "position": "DEF", "team": tm, "age": None,
                       "injury_status": None, "status": "Active", "fantasy_positions": ["DEF"], "active": True}
        base[tm] = 4 + rnd.random() * 6

    # search_rank: dynasty-ish ordering (young + productive first)
    def dyn(pid):
        p = players[pid]
        b = base[pid]
        if p["position"] in ("K", "DEF"):
            return b - 30
        age = p["age"]
        adj = {"QB": 0 if age < 33 else -6, "RB": 2 if age <= 24 else (-1 if age >= 27 else 0),
               "WR": 1 if age <= 25 else (-2 if age >= 30 else 0), "TE": 0}[p["position"]]
        return b + adj + (2 if p["position"] == "QB" else 0)

    order = sorted(players, key=lambda x: -dyn(x))
    for r, pid in enumerate(order, 1):
        players[pid]["search_rank"] = r if players[pid]["position"] not in ("K", "DEF") else 900 + r

    # Raw per-stat lines (not canned point totals), mirroring what Sleeper's real
    # projections/stats endpoints return -- so the fetcher's real dot-product
    # scoring (raw stats x a league's own scoring_settings) has something to chew
    # on, the same as the actual Sleeper API.
    def raw_for(pos, pts, rr):
        # Scaled random ranges (not a solved equation -- avoids blowing up for
        # small/large pts) so a better player's raw stats trend higher too.
        scale = max(0.3, pts / 20.0)
        if pos == "QB":
            return {"pass_yd": round(rr.uniform(180, 320) * scale), "pass_td": rr.choice([0, 1, 1, 2, 2, 3]),
                    "pass_int": rr.choice([0, 0, 0, 1]), "rush_yd": round(rr.uniform(0, 30) * scale)}
        if pos == "RB":
            rec = rr.randint(0, 6)
            return {"rush_yd": round(rr.uniform(30, 110) * scale), "rush_td": rr.choice([0, 0, 1, 1, 2]),
                    "rec": rec, "rec_yd": rec * rr.randint(5, 11)}
        if pos in ("WR", "TE"):
            return {"rec": rr.randint(2, 9), "rec_yd": round(rr.uniform(20, 110) * scale),
                    "rec_td": rr.choice([0, 0, 0, 1, 1])}
        if pos == "K":
            return {"fgm_30_39": rr.choice([0, 1, 1, 2, 2, 3]), "xpm": rr.randint(0, 4)}
        if pos == "DEF":
            bucket = rr.choice(["pts_allow_0", "pts_allow_1_6", "pts_allow_7_13", "pts_allow_14_20", "pts_allow_21_27"])
            return {bucket: 1, "sack": rr.randint(0, 4), "def_td": 1 if rr.random() < 0.12 else 0}
        return {}

    # weekly history
    stats = {}
    for wk in range(1, WEEK):
        rows = []
        for pid, b in base.items():
            if rnd.random() < 0.08:
                continue
            pts = max(0, b * rnd.uniform(0.5, 1.5))
            pos = players[pid]["position"]
            st = raw_for(pos, pts, rnd)
            tgt = round((st.get("rec", 0)) * 1.5) if pos in ("WR", "TE", "RB") else 0
            rush = round(pts / 1.1) if pos == "RB" else 0
            st.update({"rec_tgt": tgt, "rush_att": rush, "gp": 1})
            rows.append({"player_id": pid, "week": wk, "stats": st})
        stats[wk] = rows

    projections = []
    for pid, b in base.items():
        tm = players[pid]["team"]
        if tm in BYE_TEAMS:
            continue
        pos = players[pid]["position"]
        p = max(0.5, b * rnd.uniform(0.9, 1.1))
        st = raw_for(pos, p, rnd)
        projections.append({"player_id": pid, "week": WEEK, "team": tm, "opponent": rnd.choice([t for t in NFL if t != tm]),
                            "stats": st})

    # a few injuries
    ids_by_rank = [p for p in order if players[p]["position"] in ("QB", "RB", "WR", "TE")]
    for pid, st in zip(ids_by_rank[8:60:7], ["Questionable", "Out", "Doubtful", "Questionable", "IR", "Questionable", "Out", "Doubtful"]):
        players[pid]["injury_status"] = st

    # leagues
    users_all = [{"user_id": str(9000 + i), "display_name": nm, "metadata": {"team_name": tn}} for i, (nm, tn) in enumerate([
        ("PatrickSerio", "Ja'Marr Marr Binks"), ("gridiron_gus", "Gus's Gladiators"), ("kelsey_k", "Kelsey's Crew"),
        ("tdtony", "Touchdown Tony"), ("bigmikey", "Big Mikey Bombers"), ("jules_c", "Jules Verne Machine"),
        ("razorray", "Razor Ray"), ("sunday_sam", "Sunday Scaries"), ("dynastyd", "Dynasty Dan"),
        ("waiverwendy", "Waiver Wendy"), ("blitzbob", "Blitz Bob"), ("fieldgoalfred", "Fred's Foot")])]

    def draft(league_seed, rounds, slots_taxi=0):
        rr = random.Random(league_seed)
        pool = [p for p in players if players[p]["position"] != "DEF" or rr.random() < 0.5]
        val = {p: (dyn(p) if league_seed % 2 == 0 else base[p]) + rr.uniform(-2, 2) for p in pool}
        pool.sort(key=lambda p: -val[p])
        rosters = [[] for _ in range(12)]
        need = {"QB": 2, "K": 1, "DEF": 1, "TE": 2}
        idx = 0
        for rd in range(rounds):
            seq = range(12) if rd % 2 == 0 else range(11, -1, -1)
            for team in seq:
                for pid in pool:
                    pos = players[pid]["position"]
                    have = sum(1 for x in rosters[team] if players[x]["position"] == pos)
                    if pos in ("K", "DEF") and have >= 1:
                        continue
                    if pos == "QB" and have >= 3:
                        continue
                    if pos in ("K", "DEF") and rd < rounds - 3:
                        continue
                    rosters[team].append(pid)
                    pool.remove(pid)
                    break
        return rosters

    def make_league(lid, name, kind, seed_):
        dyn_lg = kind == "dynasty"
        rounds = 17 if dyn_lg else 15
        rs = draft(seed_, rounds)
        slots = (["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX"] + ["BN"] * 8) if dyn_lg else \
                (["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"] + ["BN"] * 6)
        ir = 2 if dyn_lg else 1
        taxi = 3 if dyn_lg else 0
        me_i = 3 if dyn_lg else 6
        rosters, matchups = [], []
        for i, players_ in enumerate(rs):
            rid = i + 1
            ordered = sorted(players_, key=lambda p: -base[p])
            reserve = [p for p in ordered if players[p]["injury_status"] in ("Out", "IR")][:ir]
            active = [p for p in ordered if p not in reserve]
            taxi_ids = []
            if taxi:
                young = [p for p in reversed(active) if players[p]["position"] in ("RB", "WR", "TE", "QB") and players[p]["age"] <= 23]
                taxi_ids = young[:taxi]
                active = [p for p in active if p not in taxi_ids]
            starters, used = [], set()
            for s in slots:
                if s == "BN":
                    continue
                elig = {"QB": ["QB"], "RB": ["RB"], "WR": ["WR"], "TE": ["TE"], "K": ["K"], "DEF": ["DEF"],
                        "FLEX": ["RB", "WR", "TE"], "SUPER_FLEX": ["QB", "RB", "WR", "TE"]}[s]
                pick = next((p for p in active if p not in used and players[p]["position"] in elig), "0")
                starters.append(pick)
                used.add(pick)
            rosters.append({"roster_id": rid, "owner_id": users_all[i]["user_id"],
                            "players": active + reserve + taxi_ids, "starters": starters,
                            "reserve": reserve or None, "taxi": taxi_ids or None,
                            "settings": {"wins": rnd.randint(0, 2), "losses": rnd.randint(0, 2), "ties": 0}})
        # order: user index 0 is Patrick; move him to me_i
        users = users_all[:]
        users[0], users[me_i] = users[me_i], users[0]
        for i, r in enumerate(rosters):
            r["owner_id"] = users[i]["user_id"]
        for i in range(0, 12, 2):
            matchups.append({"roster_id": i + 1, "matchup_id": i // 2 + 1, "points": 0.0})
            matchups.append({"roster_id": i + 2, "matchup_id": i // 2 + 1, "points": 0.0})
        detail = {"league_id": lid, "name": name, "season": SEASON, "roster_positions": slots,
                  "scoring_settings": {
                      **SCORING_BASE, "rec": 1.0 if dyn_lg else 0.5,
                  },
                  "settings": {"type": 2 if dyn_lg else 0, "reserve_slots": ir, "taxi_slots": taxi, "draft_rounds": 4}}
        traded = [{"season": str(int(SEASON) + 1), "round": 1, "roster_id": 5, "owner_id": me_i + 1, "previous_owner_id": 5},
                  {"season": str(int(SEASON) + 1), "round": 2, "roster_id": me_i + 1, "owner_id": 8, "previous_owner_id": me_i + 1}] if dyn_lg else []
        return {"detail": detail, "rosters": rosters, "users": users, "matchups": matchups, "traded": traded}

    leagues = {"8001": make_league("8001", "Dynasty Degenerates", "dynasty", 42),
               "8002": make_league("8002", "Sunday Funday (Redraft)", "redraft", 43)}
    me = users_all[0]["user_id"]
    trending = [{"player_id": pid, "count": 500 - i * 9} for i, pid in enumerate(
        [p for p in order if players[p]["position"] in ("RB", "WR", "TE")][60:100:2])]
    return {"user": {"user_id": me, "username": "PatrickSerio", "display_name": "PatrickSerio"},
            "state": {"season": SEASON, "week": WEEK, "season_type": "regular"},
            "players": players, "projections": projections, "stats": stats, "trending": trending,
            "leagues": leagues}
