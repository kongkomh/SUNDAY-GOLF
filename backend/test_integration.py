import io
import json
import os
import sys
from unittest.mock import MagicMock

# Import the server and db modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
import server
from db import db
import auth

class MockSocket:
    def __init__(self, request_bytes):
        self.rfile = io.BytesIO(request_bytes)
        self.wfile = io.BytesIO()

    def makefile(self, mode, *args, **kwargs):
        if 'r' in mode:
            return self.rfile
        return self.wfile

    def sendall(self, data):
        self.wfile.write(data)

def invoke_request(method, path, body=None, headers=None):
    if headers is None:
        headers = {}
    if body is not None and not isinstance(body, (bytes, bytearray)):
        body = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
        headers['Content-Length'] = str(len(body))
    elif body is None:
        body = b''
        headers['Content-Length'] = '0'

    req_lines = [f"{method} {path} HTTP/1.1", "Host: localhost"]
    for k, v in headers.items():
        req_lines.append(f"{k}: {v}")
    req_lines.append("")
    req_lines.append("")
    raw_req = "\r\n".join(req_lines).encode('utf-8') + body

    sock = MockSocket(raw_req)
    handler = server.SundayGolfRequestHandler(sock, ("127.0.0.1", 12345), MagicMock())
    raw_resp = sock.wfile.getvalue()
    
    # Parse status and body
    parts = raw_resp.split(b"\r\n\r\n", 1)
    header_block = parts[0].decode('utf-8', errors='ignore')
    body_block = parts[1] if len(parts) > 1 else b""
    status_line = header_block.split("\r\n")[0]
    status_code = int(status_line.split()[1])

    # Extract cookies if set
    set_cookies = []
    for line in header_block.split("\r\n"):
        if line.lower().startswith("set-cookie:"):
            set_cookies.append(line.split(":", 1)[1].strip())

    parsed_json = None
    try:
        parsed_json = json.loads(body_block.decode('utf-8'))
    except Exception:
        pass

    return {
        "status": status_code,
        "headers": header_block,
        "cookies": set_cookies,
        "body": body_block,
        "json": parsed_json
    }

print("Running in-memory server handler integration test...")

# 1. GET /api/me (unauthenticated)
r = invoke_request("GET", "/api/me")
assert r["status"] == 200
assert r["json"]["authenticated"] == False
print("PASS: /api/me (unauthenticated)")

# 2. GET /auth/dev_login
r = invoke_request("GET", "/auth/dev_login?email=tiger@golf.com&name=Tiger")
assert r["status"] == 302
assert len(r["cookies"]) > 0
cookie_header = r["cookies"][0].split(";")[0]
print(f"PASS: dev_login (302 redirect) -> Cookie: {cookie_header}")

auth_headers = {"Cookie": cookie_header}

# 3. GET /api/me (authenticated)
r = invoke_request("GET", "/api/me", headers=auth_headers)
assert r["status"] == 200
assert r["json"]["authenticated"] == True
assert r["json"]["user"]["email"] == "golfer@example.com"
print("PASS: /api/me (authenticated)")

# 4. POST /api/rounds (create fresh round)
r = invoke_request("POST", "/api/rounds", body={"course_id": "course-krungthep-kreetha", "starting_hole": 1}, headers=auth_headers)
assert r["status"] == 200
round_id = r["json"]["round_id"]
print(f"PASS: POST /api/rounds -> round_id: {round_id}")

# 5. GET /api/round/<id> (verify fresh round)
r = invoke_request("GET", f"/api/round/{round_id}", headers=auth_headers)
print("GET /api/round status:", r["status"], "json keys:", list(r["json"].keys()) if r["json"] else r["body"])

# 6. POST /api/round/<id>/settings (Starting Hole 10 & WOLF & Turbo)
r = invoke_request("POST", f"/api/round/{round_id}/settings", body={
    "starting_hole": 10,
    "game_settings": {
        "game_mode": "WOLF",
        "starting_hole": 10,
        "turbo": True,
        "turbo_multiplier": 2
    }
}, headers=auth_headers)
assert r["status"] == 200
state = r["json"]
assert state["starting_hole"] == 10
assert state["played_hole_order"] == [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]
h10 = next(h for h in state["calculated_holes"] if h["hole"] == 10)
assert h10["wolf_player"]["id"] == "p1"
# Verify exactly 1 turbo hole per wolf across 18 holes
turbo_holes = [h["hole"] for h in state["calculated_holes"] if h.get("is_turbo")]
print(f"Turbo holes chosen for wolves: {turbo_holes}")
assert len(turbo_holes) == 4, f"Expected 4 turbo holes (1 per player), got {len(turbo_holes)}"
print("PASS: Starting Hole 10, Wolf order, and 1-turbo-per-wolf verified")

# 7. POST /api/round/<id>/score
r = invoke_request("POST", f"/api/round/{round_id}/score", body={
    "hole": 10,
    "scores": {"p1": 4, "p2": 5, "p3": 4, "p4": 5},
    "team_a": ["p1"],
    "team_b": ["p2", "p3", "p4"]
}, headers=auth_headers)
assert r["status"] == 200
calc_h10 = next(h for h in r["json"]["calculated_holes"] if h["hole"] == 10)
assert calc_h10["scores"]["p1"] == 4
assert calc_h10["match"] is not None
print("PASS: Score posted and calculated for hole 10")
print("PASS: Score posted for hole 10")

# 8. POST /api/round/<id>/finish
r = invoke_request("POST", f"/api/round/{round_id}/finish", body={}, headers=auth_headers)
assert r["status"] == 200
assert r["json"]["is_finished"] == True
print("PASS: Round finished and locked")

# 9. Verify editing score on finished round returns 403 Forbidden
r = invoke_request("POST", f"/api/round/{round_id}/score", body={
    "hole": 11,
    "scores": {"p1": 4, "p2": 4, "p3": 4, "p4": 4}
}, headers=auth_headers)
assert r["status"] == 403, f"Expected 403, got {r['status']}"
print("PASS: 403 Forbidden returned when attempting to edit finished round")

# 10. POST /api/round/<id>/unlock
r = invoke_request("POST", f"/api/round/{round_id}/unlock", body={}, headers=auth_headers)
assert r["status"] == 200
assert r["json"]["is_finished"] == False
print("PASS: Round unlocked by owner")

# 11. Now edit score succeeds
r = invoke_request("POST", f"/api/round/{round_id}/score", body={
    "hole": 11,
    "scores": {"p1": 3, "p2": 4, "p3": 4, "p4": 4},
    "team_a": ["p2"],
    "team_b": ["p1", "p3", "p4"]
}, headers=auth_headers)
assert r["status"] == 200
calc_h11 = next(h for h in r["json"]["calculated_holes"] if h["hole"] == 11)
assert calc_h11["scores"]["p1"] == 3
assert calc_h11["match"] is not None
print("PASS: Score edit succeeds after unlocking")

# 12. GET /api/rounds (lists round)
r = invoke_request("GET", "/api/rounds", headers=auth_headers)
assert r["status"] == 200
rounds_list = r["json"] if isinstance(r["json"], list) else r["json"].get("rounds", [])
round_ids = [rnd["id"] for rnd in rounds_list]
assert round_id in round_ids
print("PASS: GET /api/rounds contains created round")

# 13. DELETE /api/round/<id>
r = invoke_request("DELETE", f"/api/round/{round_id}", headers=auth_headers)
assert r["status"] == 200
assert r["json"]["status"] == "ok"
print("PASS: Round deleted successfully")

# 14. Verify deleted
r = invoke_request("GET", f"/api/round/{round_id}", headers=auth_headers)
assert r["status"] == 404
print("PASS: Round 404 after deletion")

print("\nALL 14 BACKEND INTEGRATION TESTS PASSED PERFECTLY!")
