#!/usr/bin/env python3
"""Fail the workflow (so the last good site stays live) if the fetch produced nothing useful."""
import json
import sys

d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "site/data/leagues.json"))
problems = []
if not d.get("leagues"):
    problems.append("no leagues in output")
if len(d.get("players", {})) < 50:
    problems.append("suspiciously few players")
for lg in d.get("leagues", []):
    me = [t for t in lg["teams"] if t["roster_id"] == lg["me"]]
    if not me or not me[0]["players"]:
        problems.append(f"{lg['name']}: empty roster")
if problems:
    sys.exit("Refusing to publish: " + "; ".join(problems))
print("Output looks sane:", len(d["leagues"]), "leagues,", len(d["players"]), "players")
