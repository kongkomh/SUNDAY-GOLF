"""
End-to-end integration test suite for Sunday Golf Tracker HTTP & SSE API
"""

import urllib.request
import json
import time
import subprocess
import os
import sys
import socket

def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port

def test_api():
    port = get_free_port()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    server_script = os.path.join(base_dir, "backend", "server.py")
    
    # Start server process
    proc = subprocess.Popen(
        [sys.executable, server_script, str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    time.sleep(1.5)
    
    try:
        # Reset scores first for clean test
        reset_url = f"http://localhost:{port}/api/reset"
        reset_req = urllib.request.Request(reset_url, data=json.dumps({}).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(reset_req, timeout=4) as resp:
            assert resp.getcode() == 200

        # 1. Test GET /api/tournament
        url = f"http://localhost:{port}/api/tournament"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=4) as resp:
            self_code = resp.getcode()
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            assert self_code == 200, f"Expected 200, got {self_code}"
            assert "tournament_name" in data, "tournament_name missing"
            assert "players" in data, "players missing"
            assert len(data["players"]) >= 3, f"Expected >= 3 players, got {len(data['players'])}"
            assert "holes" in data, "holes missing"
            print("✅ GET /api/tournament passed. Players:", len(data["players"]), "Holes:", len(data["holes"]), flush=True)

        # 2. Test GET /api/courses
        courses_url = f"http://localhost:{port}/api/courses"
        req = urllib.request.Request(courses_url)
        with urllib.request.urlopen(req, timeout=4) as resp:
            assert resp.getcode() == 200
            courses = json.loads(resp.read().decode("utf-8"))
            assert len(courses) >= 2, "Expected pre-loaded courses"
            assert any("Krungthep Kreetha" in c["name"] for c in courses)
            assert any("RG City" in c["name"] or "Royal Gems" in c["name"] for c in courses)
            print("✅ GET /api/courses passed. Pre-loaded courses count:", len(courses), flush=True)

        # 3. Test POST /api/players (Update to 5 players)
        players_url = f"http://localhost:{port}/api/players"
        players_payload = {
            "players": [
                {"id": "p1", "name": "Shirobon", "color": "#FFFFFF", "hcp_out": 1, "hcp_in": 1},
                {"id": "p2", "name": "Kurobon", "color": "#1E293B", "hcp_out": 0, "hcp_in": 0},
                {"id": "p3", "name": "Akabon", "color": "#EF4444", "hcp_out": 0, "hcp_in": 0},
                {"id": "p4", "name": "Aobon", "color": "#3B82F6", "hcp_out": 2, "hcp_in": 0},
                {"id": "p5", "name": "Midoribon", "color": "#10B981", "hcp_out": 0, "hcp_in": 0}
            ]
        }
        req = urllib.request.Request(players_url, data=json.dumps(players_payload).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            assert resp.getcode() == 200
            p_data = json.loads(resp.read().decode("utf-8"))
            assert len(p_data["players"]) == 5
            print("✅ POST /api/players passed. Updated players to 5.", flush=True)

        # 4. Test POST /api/score (Record Hole 1)
        score_url = f"http://localhost:{port}/api/score"
        score_payload = {
            "hole": 1,
            "team_a": ["p1", "p2"],
            "team_b": ["p3", "p4", "p5"],
            "scores": {
                "p1": 4, # Par
                "p2": 4, # Par
                "p3": 5, # Bogey
                "p4": 5, # Bogey
                "p5": 6  # Dbl
            }
        }
        req = urllib.request.Request(score_url, data=json.dumps(score_payload).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            assert resp.getcode() == 200
            updated_data = json.loads(resp.read().decode("utf-8"))
            h1 = next(h for h in updated_data["calculated_holes"] if h["hole"] == 1)
            assert h1["match"]["played"] is True
            won_pt = h1["match"]["won_point"]
            p1_card = next(p for p in updated_data["player_scorecards"] if p["id"] == "p1")
            assert p1_card["total_points"] == round(won_pt * (3 / 2), 2)
            print("✅ POST /api/score passed. Won points:", won_pt, "P1 Cash:", p1_card["total_cash"], flush=True)

        # 5. Test POST /api/settings (Switch to WOLF mode)
        settings_url = f"http://localhost:{port}/api/settings"
        settings_payload = {
            "game_settings": {
                "game_mode": "WOLF",
                "cash_per_point": 200,
                "turbo": True,
                "turbo_multiplier": 5
            }
        }
        req = urllib.request.Request(settings_url, data=json.dumps(settings_payload).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            assert resp.getcode() == 200
            set_res = json.loads(resp.read().decode("utf-8"))
            assert set_res["game_settings"]["game_mode"] == "WOLF"
            assert set_res["game_settings"]["cash_per_point"] == 200
            print("✅ POST /api/settings passed. Mode: WOLF", flush=True)

        # 6. Test GET / static HTML
        index_url = f"http://localhost:{port}/"
        with urllib.request.urlopen(index_url, timeout=4) as resp:
            assert resp.getcode() == 200
            content = resp.read().decode("utf-8")
            assert "Sunday Golf" in content
            print("✅ GET / static HTML served successfully.", flush=True)

        # 7. Test HEAD / and HEAD /api/tournament (UptimeRobot / Health Check support)
        head_req = urllib.request.Request(index_url, method="HEAD")
        with urllib.request.urlopen(head_req, timeout=4) as resp:
            assert resp.getcode() == 200
            assert resp.headers.get("Content-Type") == "text/html"
            print("✅ HEAD / passed (200 OK, headers only).", flush=True)

        head_api_req = urllib.request.Request(f"http://localhost:{port}/api/tournament", method="HEAD")
        with urllib.request.urlopen(head_api_req, timeout=4) as resp:
            assert resp.getcode() == 200
            assert resp.headers.get("Content-Type") == "application/json"
            print("✅ HEAD /api/tournament passed (200 OK, headers only).", flush=True)

        print("\n🎉 ALL E2E API AND INTEGRATION TESTS PASSED PERFECTLY!", flush=True)

    finally:
        try:
            proc.kill()
        except Exception:
            pass

if __name__ == "__main__":
    test_api()
