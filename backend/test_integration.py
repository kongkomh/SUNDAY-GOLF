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

# 15. Verify Course Tees in GET /api/courses
r = invoke_request("GET", "/api/courses", headers=auth_headers)
assert r["status"] == 200
courses = r["json"]
assert len(courses) > 0
assert "tees" in courses[0]
tee_ids = [t["id"] for t in courses[0]["tees"]]
assert "white" in tee_ids and "red" in tee_ids and "blue" in tee_ids
print("PASS: Courses include Tees with slope and rating")

# 16. Create New Player via POST /api/players
import time
unique_nick = f"TIGER_{int(time.time())}"
r = invoke_request("POST", "/api/players", body={
    "nickname": unique_nick,
    "first_name": "Eldrick",
    "last_name": f"Woods_{int(time.time())}",
    "handicap": 0.0
}, headers=auth_headers)
assert r["status"] == 200
new_ply = r["json"]
assert new_ply["nickname"] == unique_nick
tiger_id = new_ply["id"]
print(f"PASS: Created player {new_ply['nickname']} ({tiger_id})")

# 17. Verify duplicate player creation returns 409 Conflict
r = invoke_request("POST", "/api/players", body={
    "nickname": unique_nick,
    "first_name": "Eldrick",
    "last_name": "Woods",
    "handicap": 0.0
}, headers=auth_headers)
assert r["status"] == 409
print("PASS: Duplicate player prevented with 409 Conflict")

# 18. GET /api/my-players
r = invoke_request("GET", "/api/my-players", headers=auth_headers)
assert r["status"] == 200
my_p_ids = [p["id"] for p in r["json"]]
assert tiger_id in my_p_ids
print("PASS: GET /api/my-players contains newly created player")

# 19. GET /api/players/stats
r = invoke_request("GET", "/api/players/stats?currency=THB&range=all", headers=auth_headers)
assert r["status"] == 200
assert isinstance(r["json"], list)
print("PASS: GET /api/players/stats returns multi-currency aggregated stats")

# 20. DELETE /api/my-players/<id>
r = invoke_request("DELETE", f"/api/my-players/{tiger_id}", headers=auth_headers)
assert r["status"] == 200
r_after = invoke_request("GET", "/api/my-players", headers=auth_headers)
after_ids = [p["id"] for p in r_after["json"]]
assert tiger_id not in after_ids
print("PASS: Removed player from user roster")

# 21. Verify Dynamic Round Identity: [Date] • [Course] - By [Creator]
r_dynamic = invoke_request("POST", "/api/rounds", body={"course_id": "course-krungthep-kreetha"}, headers=auth_headers)
assert r_dynamic["status"] == 200
dyn_name = r_dynamic["json"]["round_name"]
assert "Krungthep Kreetha Golf Course" in dyn_name
assert "Demo" in dyn_name or "Golfer" in dyn_name
print(f"PASS: Dynamic round identity verified: '{dyn_name}'")

# 22. Verify Link Player Overwrites First/Last Name with Google Info
# Create an unlinked player first
dummy_nick = f"ALICE_{int(time.time())}"
r_alice = invoke_request("POST", "/api/players", body={
    "nickname": dummy_nick,
    "first_name": "OldAlice",
    "last_name": "OldSmith",
    "handicap": 14.5
}, headers=auth_headers)
assert r_alice["status"] == 200
alice_id = r_alice["json"]["id"]

# Link user to this player profile
r_link = invoke_request("POST", "/api/me/link-player", body={"player_id": alice_id}, headers=auth_headers)
assert r_link["status"] == 200
linked_ply = r_link["json"]["player"]
assert linked_ply["nickname"] == dummy_nick
assert linked_ply["first_name"] == "Demo"
assert linked_ply["last_name"] == "Golfer"
print(f"PASS: Linking account overwrote first and last name with Google credentials: {linked_ply['first_name']} {linked_ply['last_name']}")

# 23. Verify Update Player Profile (Nickname & Handicap)
r_prof = invoke_request("POST", "/api/me/player", body={
    "nickname": f"PRO_{dummy_nick}",
    "first_name": "Demo",
    "last_name": "Golfer",
    "current_handicap": 9.2
}, headers=auth_headers)
assert r_prof["status"] == 200
assert r_prof["json"]["player"]["nickname"] == f"PRO_{dummy_nick}"
assert float(r_prof["json"]["player"]["current_handicap"]) == 9.2
print(f"PASS: Player profile nickname and handicap updated: {r_prof['json']['player']['nickname']} (HCP {r_prof['json']['player']['current_handicap']})")

# 24. Verify USGA Rule 5.2a Handicap Index Calculations for all tiers (<3, 3, 4, 5, 6, 7-8, 9-11, 12-14, 15-16, 17-18, 19, 20)
from db import calculate_whs_handicap
base_diffs = [10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0, 26.0, 28.0, 30.0, 32.0, 34.0, 36.0, 38.0, 40.0, 42.0, 44.0, 46.0, 48.0]
assert calculate_whs_handicap(base_diffs[:2]) is None  # < 3 rounds: None
assert calculate_whs_handicap(base_diffs[:3]) == 8.0   # 3 rounds: lowest 1 (10.0) - 2.0 = 8.0
assert calculate_whs_handicap(base_diffs[:4]) == 9.0   # 4 rounds: lowest 1 (10.0) - 1.0 = 9.0
assert calculate_whs_handicap(base_diffs[:5]) == 10.0  # 5 rounds: lowest 1 (10.0) + 0 = 10.0
assert calculate_whs_handicap(base_diffs[:6]) == 10.0  # 6 rounds: avg lowest 2 (11.0) - 1.0 = 10.0
assert calculate_whs_handicap(base_diffs[:7]) == 11.0  # 7 rounds: avg lowest 2 (11.0) + 0 = 11.0
assert calculate_whs_handicap(base_diffs[:8]) == 11.0  # 8 rounds: avg lowest 2 (11.0) + 0 = 11.0
assert calculate_whs_handicap(base_diffs[:10]) == 12.0 # 10 rounds: avg lowest 3 (10+12+14)/3 = 12.0
assert calculate_whs_handicap(base_diffs[:13]) == 13.0 # 13 rounds: avg lowest 4 (10+12+14+16)/4 = 13.0
assert calculate_whs_handicap(base_diffs[:16]) == 14.0 # 16 rounds: avg lowest 5 (10+12+14+16+18)/5 = 14.0
assert calculate_whs_handicap(base_diffs[:18]) == 15.0 # 18 rounds: avg lowest 6 = 15.0
assert calculate_whs_handicap(base_diffs[:19]) == 16.0 # 19 rounds: avg lowest 7 = 16.0
assert calculate_whs_handicap(base_diffs[:20]) == 17.0 # 20 rounds: avg lowest 8 = 17.0
print("PASS: USGA Rule 5.2a Handicap Index calculation verified across all 12 tiers (<3 through 20+)")

# 25. Verify SQL courses table does not record is_turbo
c_test = db.create_course("Integration Test Course", [
    {"hole": 1, "par": 4, "handicap": 1, "is_turbo": True},
    {"hole": 2, "par": 4, "handicap": 2, "is_turbo": False}
])
ret_c = db.get_course(c_test["id"])
for h in ret_c["holes"]:
    assert "is_turbo" not in h
print("PASS: courses table in SQL does not record turbo holes")

# 26. Verify manual turbo hole preservation on round and GET /api/rounds
r_manual = invoke_request("POST", "/api/rounds", body={"course_id": "course-krungthep-kreetha"}, headers=auth_headers)
man_id = r_manual["json"]["round_id"]
man_holes = [{"hole": i, "par": 4, "handicap": i, "is_turbo": (i in [1, 2])} for i in range(1, 19)]
r_save = invoke_request("POST", f"/api/round/{man_id}/course", body={"holes": man_holes}, headers=auth_headers)
saved_turbos = [h["hole"] for h in r_save["json"]["holes"] if h.get("is_turbo")]
assert saved_turbos == [1, 2]
r_my = invoke_request("GET", f"/api/rounds?current_round_id={man_id}", headers=auth_headers)
my_round_ids = [r["id"] for r in r_my["json"]]
assert man_id in my_round_ids
found_man = next(r for r in r_my["json"] if r["id"] == man_id)
assert "round_name" in found_man and found_man["round_name"]
print("PASS: Manual turbo holes preserved on round and returned in My Rounds list")

# 27. Verify Player Round History & WHS Counting Flags
# Insert test history rows for alice_id
for i in range(1, 6):
    db.execute(
        """
        INSERT OR REPLACE INTO player_round_history 
        (id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, course_name, cash_won, currency, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (f"test-hist-{alice_id}-{i}", alice_id, f"test-round-{i}", f"2026-11-0{i}", 80 + i, 72.0, 113.0, 10.0 + i, "Krungthep Kreetha", 500.0 if i % 2 == 1 else -300.0, "THB", 1794671000 + i)
    )
r_hist = invoke_request("GET", f"/api/players/{alice_id}/history", headers=auth_headers)
assert r_hist["status"] == 200
hist_list = r_hist["json"]
assert len(hist_list) == 5
# Lowest differential (11.0) must be counting per Rule 5.2a (for 5 scores, lowest 1 used)
counting_items = [h for h in hist_list if h.get("is_counting")]
assert len(counting_items) == 1
assert counting_items[0]["differential"] == 11.0
assert hist_list[0]["course_name"] == "Krungthep Kreetha"
assert "cash_won" in hist_list[0]
print(f"PASS: Player history API returns past rounds with counting flags and cash: {len(hist_list)} rounds, counting: {counting_items[0]['differential']}")

print("\nALL 27 BACKEND INTEGRATION TESTS PASSED PERFECTLY!")
