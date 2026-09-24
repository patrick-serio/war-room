"""Tiny HTTP server that speaks the parts of Sleeper's API the fetcher uses."""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from mock_data import build  # noqa: E402

U = build()


def route(path):
    m = re.fullmatch
    if path == "/v1/user/PatrickSerio":
        return U["user"]
    if path.startswith("/v1/user/") and "/leagues/nfl/" not in path:
        return None
    if path == "/v1/state/nfl":
        return U["state"]
    g = m(r"/v1/user/(\d+)/leagues/nfl/(\d+)", path)
    if g:
        return [{"league_id": k, "name": v["detail"]["name"], "season": U["state"]["season"]} for k, v in U["leagues"].items()]
    g = m(r"/v1/league/(\d+)", path)
    if g:
        return U["leagues"][g.group(1)]["detail"]
    g = m(r"/v1/league/(\d+)/(rosters|users|traded_picks)", path)
    if g:
        return U["leagues"][g.group(1)][{"rosters": "rosters", "users": "users", "traded_picks": "traded"}[g.group(2)]]
    g = m(r"/v1/league/(\d+)/matchups/(\d+)", path)
    if g:
        return U["leagues"][g.group(1)]["matchups"]
    if path == "/v1/players/nfl":
        return U["players"]
    if path == "/v1/players/nfl/trending/add":
        return U["trending"]
    g = m(r"/projections/nfl/(\d+)/(\d+)", path)
    if g:
        return U["projections"]
    g = m(r"/stats/nfl/(\d+)/(\d+)", path)
    if g:
        return U["stats"].get(int(g.group(2)), [])
    return None


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = route(urlparse(self.path).path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
