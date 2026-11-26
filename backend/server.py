"""
Sunday Golf Tracker - Multi-Instance HTTP & Server-Sent Events (SSE) Server
Supports Google OAuth 2.0, Multi-Round Instances, PostgreSQL & SQLite.
"""

import http.server
import socketserver
import json
import os
import sys
import time
import copy
import re
import threading
import urllib.parse
from http import cookies
from typing import Dict, List, Any, Optional

from engine import (
    calculate_tournament_state,
    compute_wolf_turbo_holes,
    DEFAULT_PLAYERS,
    DEFAULT_HOLES,
    DEFAULT_SETTINGS,
    DEFAULT_PLAYER_COLORS,
    DEFAULT_PLAYER_NAMES
)
from db import db, DEFAULT_TEES
import auth

PORT = int(os.environ.get("PORT", 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")

ADMIN_EMAILS = {"kongkomh@gmail.com"}

def is_admin(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    email = (user.get("email") or "").strip().lower()
    return email in ADMIN_EMAILS


def copy_dict(d):
    return json.loads(json.dumps(d))


def sanitize_scores_with_players(scores: Dict[str, Any], valid_player_ids: set) -> Dict[str, Any]:
    clean_scores = {}
    for h_key, h_entry in scores.items():
        if isinstance(h_entry, dict):
            clean_entry = {}
            if "team_a" in h_entry and isinstance(h_entry["team_a"], list):
                clean_entry["team_a"] = [pid for pid in h_entry["team_a"] if pid in valid_player_ids]
            if "team_b" in h_entry and isinstance(h_entry["team_b"], list):
                clean_entry["team_b"] = [pid for pid in h_entry["team_b"] if pid in valid_player_ids]
            if "scores" in h_entry and isinstance(h_entry["scores"], dict):
                clean_entry["scores"] = {pid: v for pid, v in h_entry["scores"].items() if pid in valid_player_ids}
            clean_scores[h_key] = clean_entry
    return clean_scores


class RoundManager:
    """Manages active round memory, DB persistence, and SSE broadcasts"""
    def __init__(self):
        self.lock = threading.Lock()
        self.subscribers: Dict[str, List[http.server.BaseHTTPRequestHandler]] = {}
        self.subscribers_lock = threading.Lock()

    def get_or_create_default_round(self, owner_id: Optional[str] = None) -> Dict[str, Any]:
        with self.lock:
            latest = db.get_latest_round()
            if latest:
                return latest
            return self.create_fresh_round(owner_id)

    def create_fresh_round(self, owner_id: Optional[str] = None, course_id: Optional[str] = None) -> Dict[str, Any]:
        courses = db.list_courses()
        selected_course = None
        if course_id:
            selected_course = next((c for c in courses if c["id"] == course_id), None)
        if not selected_course and courses:
            selected_course = courses[0]

        c_name = selected_course["name"] if selected_course else "Krungthep Kreetha Golf Course"
        c_id = selected_course["id"] if selected_course else "course-krungthep-kreetha"
        holes = copy.deepcopy(selected_course.get("holes") or DEFAULT_HOLES) if selected_course else copy.deepcopy(DEFAULT_HOLES)

        # Ensure default turbo flags exist on round holes
        for h in holes:
            if "is_turbo" not in h:
                h["is_turbo"] = (int(h.get("hole", 0)) in (9, 18))

        round_data = {
            "name": "",
            "course_id": c_id,
            "course_name": c_name,
            "starting_hole": 1,
            "is_finished": False,
            "selected_tee": selected_course.get("tees", [{}])[2] if selected_course and selected_course.get("tees") else DEFAULT_TEES[2],
            "game_settings": copy.deepcopy(DEFAULT_SETTINGS),
            "players": copy.deepcopy(DEFAULT_PLAYERS),
            "holes": holes,
            "scores": {}
        }
        return db.create_round(round_data, owner_id=owner_id)

    def get_round_state(self, round_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        round_data = db.get_round(round_id)
        if not round_data:
            return None

        # Auto-claim round if user is signed in and round has no owner yet
        if user_id and not round_data.get("owner_id"):
            db.update_round(round_id, {"owner_id": user_id})
            round_data["owner_id"] = user_id

        # Generate dynamic round name [Date] • [Course] - By [Creator]
        now_ts = round_data.get("created_at") or time.time()
        date_str = time.strftime("%Y-%m-%d", time.localtime(now_ts))
        creator_first = "Guest"
        if round_data.get("owner_id"):
            user = db.get_user(round_data["owner_id"])
            if user:
                parts = (user.get("name") or "").strip().split()
                creator_first = parts[0] if parts else "Golfer"
                p_rec = db.find_player_by_user_id(round_data["owner_id"])
                if p_rec and p_rec.get("first_name"):
                    creator_first = p_rec["first_name"]

        c_name = round_data.get("course_name") or "Golf Course"
        dynamic_round_title = f"{date_str} • {c_name} - By {creator_first}"

        state = calculate_tournament_state(round_data)
        state["round_id"] = round_id
        state["id"] = round_id
        state["round_name"] = dynamic_round_title
        state["date_str"] = date_str
        state["creator_name"] = creator_first
        state["owner_id"] = round_data.get("owner_id")
        state["is_finished"] = bool(round_data.get("is_finished", False))
        state["is_manual"] = bool(round_data.get("is_manual", False))
        state["is_owner"] = bool(user_id and round_data.get("owner_id") and user_id == round_data.get("owner_id"))
        state["starting_hole"] = round_data.get("starting_hole", 1)
        state["selected_tee"] = round_data.get("selected_tee") or DEFAULT_TEES[2]
        state["created_at"] = round_data.get("created_at")
        state["updated_at"] = round_data.get("updated_at")
        return state

    def set_hole_scores(self, round_id: str, hole_num: int, score_data: Optional[Dict[str, Any]],
                        team_a: Optional[List[str]] = None, team_b: Optional[List[str]] = None,
                        user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            round_data = db.get_round(round_id)
            if not round_data:
                return None
            if round_data.get("is_finished"):
                return {"error": "Round is finished and locked"}

            scores = round_data.get("scores") or {}
            valid_ids = set(p["id"] for p in round_data.get("players", []))
            h_key = str(hole_num)

            if score_data is None or len(score_data) == 0:
                scores.pop(h_key, None)
            else:
                current_entry = scores.setdefault(h_key, {})
                if "scores" not in current_entry:
                    current_entry["scores"] = {}
                clean_scores = {pid: v for pid, v in score_data.items() if pid in valid_ids}
                current_entry["scores"].update(clean_scores)

                if team_a is not None:
                    current_entry["team_a"] = [pid for pid in team_a if pid in valid_ids]
                if team_b is not None:
                    current_entry["team_b"] = [pid for pid in team_b if pid in valid_ids]

            round_data["scores"] = scores
            db.update_round(round_id, {"scores": scores})
            state = self.get_round_state(round_id, user_id)
            self.broadcast_event(round_id, "score_update", state)
            return state

    def update_settings(self, round_id: str, new_settings: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            round_data = db.get_round(round_id)
            if not round_data:
                return None
            if round_data.get("is_finished"):
                return {"error": "Round is finished and locked"}

            # Support both flat and nested game_settings dictionary
            merged_settings = dict(new_settings)
            if "game_settings" in new_settings and isinstance(new_settings["game_settings"], dict):
                merged_settings.update(new_settings["game_settings"])

            settings = round_data.get("game_settings") or copy.deepcopy(DEFAULT_SETTINGS)
            for k in ["cash_per_point", "hand_count", "turbo_multiplier", "penetrate_bonus", "lone_wolf_bonus", "birdie_point", "eagle_point", "albatross_point"]:
                if k in merged_settings and merged_settings[k] is not None:
                    try:
                        val = int(merged_settings[k])
                        if k == "lone_wolf_bonus":
                            val = max(0, val)
                        settings[k] = val
                    except (ValueError, TypeError):
                        pass

            for k in ["turbo", "turbo_handicap", "penetrate"]:
                if k in merged_settings:
                    settings[k] = bool(merged_settings[k])

            if "game_mode" in merged_settings:
                mode = str(merged_settings["game_mode"]).upper()
                if mode in ["TEAMS", "FREE_FOR_ALL", "WOLF"]:
                    settings["game_mode"] = mode

            if "default_teams" in merged_settings and isinstance(merged_settings["default_teams"], dict):
                settings["default_teams"] = merged_settings["default_teams"]

            starting_hole = int(merged_settings.get("starting_hole") or round_data.get("starting_hole") or 1)
            if starting_hole not in (1, 10):
                starting_hole = 1
            settings["starting_hole"] = starting_hole

            round_data["game_settings"] = settings
            round_data["starting_hole"] = starting_hole

            update_fields = {
                "game_settings": settings,
                "starting_hole": starting_hole
            }

            # Support course and tee update when saving game settings
            if "course_id" in merged_settings and merged_settings["course_id"]:
                new_cid = str(merged_settings["course_id"])
                if new_cid != round_data.get("course_id"):
                    new_course = db.get_course(new_cid)
                    if new_course:
                        round_data["course_id"] = new_course["id"]
                        round_data["course_name"] = new_course["name"]
                        tees = new_course.get("tees") or DEFAULT_TEES
                        sel_tee_in = merged_settings.get("selected_tee")
                        if isinstance(sel_tee_in, dict) and sel_tee_in.get("id"):
                            round_data["selected_tee"] = sel_tee_in
                        elif isinstance(sel_tee_in, str):
                            round_data["selected_tee"] = next((t for t in tees if t["id"] == sel_tee_in), tees[0])
                        else:
                            round_data["selected_tee"] = tees[2] if len(tees) > 2 else tees[0]

                        # Set course holes
                        new_holes = copy.deepcopy(new_course.get("holes") or DEFAULT_HOLES)
                        for h in new_holes:
                            if "is_turbo" not in h:
                                h["is_turbo"] = (int(h.get("hole", 0)) in (9, 18))
                        round_data["holes"] = new_holes
                        update_fields["course_id"] = round_data["course_id"]
                        update_fields["course_name"] = round_data["course_name"]
                        update_fields["selected_tee"] = round_data["selected_tee"]
                        update_fields["holes"] = new_holes
            elif "selected_tee" in merged_settings and merged_settings["selected_tee"]:
                round_data["selected_tee"] = merged_settings["selected_tee"]
                update_fields["selected_tee"] = round_data["selected_tee"]

            # If WOLF mode with turbo enabled, automatically assign wolf turbo holes upon saving game settings
            if settings.get("game_mode") == "WOLF" and settings.get("turbo"):
                players = round_data.get("players") or DEFAULT_PLAYERS
                holes = round_data.get("holes") or copy.deepcopy(DEFAULT_HOLES)
                wolf_turbos = compute_wolf_turbo_holes(players, holes, starting_hole)
                for h in holes:
                    h["is_turbo"] = (int(h.get("hole", 0)) in wolf_turbos)
                round_data["holes"] = holes
                update_fields["holes"] = holes

            db.update_round(round_id, update_fields)
            state = self.get_round_state(round_id, user_id)
            self.broadcast_event(round_id, "settings_update", state)
            return state

    def update_players(self, round_id: str, players_list: List[Dict[str, Any]], user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            round_data = db.get_round(round_id)
            if not round_data:
                return None
            if round_data.get("is_finished"):
                return {"error": "Round is finished and locked"}

            clean_players = []
            for i, p in enumerate(players_list[:6]):
                p_id = p.get("id") or f"p{i+1}"
                name = str(p.get("name") or DEFAULT_PLAYER_NAMES[i]).strip()
                color = str(p.get("color") or DEFAULT_PLAYER_COLORS[i])
                try:
                    hcp_out = max(0, min(18, int(p.get("hcp_out", 0))))
                except Exception:
                    hcp_out = 0
                try:
                    hcp_in = max(0, min(18, int(p.get("hcp_in", 0))))
                except Exception:
                    hcp_in = 0
                team = p.get("default_team", "left" if i < 2 else "right")
                clean_players.append({
                    "id": p_id,
                    "name": name,
                    "color": color,
                    "hcp_out": hcp_out,
                    "hcp_in": hcp_in,
                    "default_team": team,
                    "player_id": p.get("player_id") or None
                })

            valid_ids = set(p["id"] for p in clean_players)
            scores = round_data.get("scores") or {}
            clean_scores = sanitize_scores_with_players(scores, valid_ids)

            db.update_round(round_id, {
                "players": clean_players,
                "scores": clean_scores
            })
            state = self.get_round_state(round_id, user_id)
            self.broadcast_event(round_id, "players_update", state)
            return state

    def update_course(self, round_id: str, course_payload: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            round_data = db.get_round(round_id)
            if not round_data:
                return None
            if round_data.get("is_finished"):
                return {"error": "Round is finished and locked"}

            c_id = course_payload.get("course_id") or round_data.get("course_id")
            c_name = course_payload.get("course_name") or round_data.get("course_name")
            selected_tee = course_payload.get("selected_tee") or round_data.get("selected_tee") or DEFAULT_TEES[2]
            tees_in = course_payload.get("tees")

            holes_in = course_payload.get("holes")
            clean_holes = []
            if holes_in and isinstance(holes_in, list):
                for h in holes_in:
                    clean_holes.append({
                        "hole": int(h.get("hole", 1)),
                        "par": int(h.get("par", 4)),
                        "handicap": int(h.get("handicap", 9)),
                        "is_turbo": bool(h.get("is_turbo", False))
                    })
            else:
                clean_holes = round_data.get("holes", DEFAULT_HOLES)

            # Keep global courses catalog synced if course exists
            if c_id:
                db.update_course(c_id, c_name, clean_holes, tees=tees_in)

            db.update_round(round_id, {
                "course_id": c_id,
                "course_name": c_name,
                "holes": clean_holes,
                "selected_tee": selected_tee
            })
            state = self.get_round_state(round_id, user_id)
            self.broadcast_event(round_id, "course_update", state)
            return state

    def finish_round(self, round_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            round_data = db.get_round(round_id)
            if not round_data:
                return None
            owner = round_data.get("owner_id")
            if owner and user_id != owner:
                return {"error": "Only the round creator can finish this round"}

            db.set_round_finished(round_id, True)
            state = self.get_round_state(round_id, user_id)
            if round_data and state:
                try:
                    db.record_round_handicaps(round_id, round_data, state)
                except Exception as e:
                    print(f"[HCP ERROR] {e}")
            self.broadcast_event(round_id, "round_finished", state)
            return state

    def unlock_round(self, round_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            round_data = db.get_round(round_id)
            if not round_data:
                return None
            owner = round_data.get("owner_id")
            # Only owner (or anyone if no owner was assigned) can unlock
            if owner and user_id != owner:
                return {"error": "Only the round creator can unlock this round"}

            db.set_round_finished(round_id, False)
            state = self.get_round_state(round_id, user_id)
            self.broadcast_event(round_id, "round_unlocked", state)
            return state

    def reset_round_scores(self, round_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            round_data = db.get_round(round_id)
            if not round_data:
                return None
            if round_data.get("is_finished"):
                return {"error": "Round is finished and locked"}

            db.update_round(round_id, {"scores": {}})
            state = self.get_round_state(round_id, user_id)
            self.broadcast_event(round_id, "score_update", state)
            return state

    # ================= SSE BROADCASTING =================
    def add_subscriber(self, round_id: str, handler: http.server.BaseHTTPRequestHandler):
        with self.subscribers_lock:
            self.subscribers.setdefault(round_id, []).append(handler)

    def remove_subscriber(self, round_id: str, handler: http.server.BaseHTTPRequestHandler):
        with self.subscribers_lock:
            if round_id in self.subscribers and handler in self.subscribers[round_id]:
                self.subscribers[round_id].remove(handler)

    def broadcast_event(self, round_id: str, event_type: str, data: Any):
        with self.subscribers_lock:
            targets = list(self.subscribers.get(round_id, []))

        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n".encode("utf-8")
        dead = []
        for s in targets:
            try:
                s.wfile.write(payload)
                s.wfile.flush()
            except Exception:
                dead.append(s)

        with self.subscribers_lock:
            for d in dead:
                if round_id in self.subscribers and d in self.subscribers[round_id]:
                    self.subscribers[round_id].remove(d)


round_manager = RoundManager()


class SundayGolfRequestHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress verbose default request logs for clean output
        return

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def get_current_user(self) -> Optional[Dict[str, Any]]:
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        c = cookies.SimpleCookie()
        try:
            c.load(cookie_header)
        except Exception:
            return None
        session_cookie = c.get("session_token")
        if not session_cookie:
            return None
        user_id = auth.verify_session_token(session_cookie.value)
        if not user_id:
            return None
        return db.get_user(user_id)

    def get_requested_round_id(self, parsed, user_id: Optional[str] = None) -> Optional[str]:
        # 1. From path: /api/round/<round_id>/... or /round/<round_id>
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "round":
            return parts[1]
        if len(parts) >= 3 and parts[0] == "api" and parts[1] == "round":
            return parts[2]

        # 2. From query param: ?round=<round_id>
        params = urllib.parse.parse_qs(parsed.query)
        if "round" in params:
            return params["round"][0]

        # 3. If signed in, check if user has an active ongoing round
        if user_id:
            active = db.get_latest_active_round(user_id)
            if active:
                return active["id"]

        # If not found, return None (DO NOT auto-create a round!)
        return None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        user = self.get_current_user()
        user_id = user["id"] if user else None

        # 1. Google OAuth endpoints
        if path == "/auth/google":
            # Build callback URI from Host header
            host = self.headers.get("Host", f"localhost:{PORT}")
            scheme = "https" if "up.railway.app" in host or self.headers.get("X-Forwarded-Proto") == "https" else "http"
            redirect_uri = f"{scheme}://{host}/auth/google/callback"
            auth_url = auth.get_google_auth_url(redirect_uri)
            if auth_url:
                self.send_response(302)
                self.send_header("Location", auth_url)
                self.end_headers()
            else:
                # If Google OAuth credentials not set, provide convenient demo login
                self.send_response(302)
                self.send_header("Location", "/auth/dev_login")
                self.end_headers()
            return

        if path == "/auth/google/callback":
            params = urllib.parse.parse_qs(parsed.query)
            code = params.get("code", [None])[0]
            host = self.headers.get("Host", f"localhost:{PORT}")
            scheme = "https" if "up.railway.app" in host or self.headers.get("X-Forwarded-Proto") == "https" else "http"
            redirect_uri = f"{scheme}://{host}/auth/google/callback"

            if code:
                user_info = auth.exchange_code_for_user(code, redirect_uri)
                if user_info:
                    saved_user = db.upsert_user(
                        user_info["id"],
                        user_info["email"],
                        user_info["name"],
                        user_info.get("picture")
                    )
                    token = auth.create_session_token(saved_user["id"])
                    self.send_response(302)
                    self.send_header("Set-Cookie", f"session_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")
                    self.send_header("Location", "/")
                    self.end_headers()
                    return

            self.send_response(302)
            self.send_header("Location", "/?auth_error=1")
            self.end_headers()
            return

        if path == "/auth/dev_login":
            demo_user = db.upsert_user(
                "demo_user_1",
                "golfer@example.com",
                "Demo Golfer",
                "https://api.dicebear.com/7.x/bottts/svg?seed=Golfer"
            )
            token = auth.create_session_token(demo_user["id"])
            self.send_response(302)
            self.send_header("Set-Cookie", f"session_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")
            self.send_header("Location", "/")
            self.end_headers()
            return

        # 2. Auth API: Current User
        if path == "/api/me":
            if user:
                linked_p = db.find_player_by_user_id(user_id)
                self.send_json_response({
                    "authenticated": True,
                    "user": user,
                    "player": linked_p,
                    "needs_player_link": (linked_p is None),
                    "is_admin": is_admin(user)
                })
            else:
                self.send_json_response({
                    "authenticated": False,
                    "user": None,
                    "player": None,
                    "needs_player_link": False,
                    "is_admin": False,
                    "google_configured": auth.is_google_oauth_configured()
                })
            return

        # 3. Courses API
        if path == "/api/courses":
            courses = db.list_courses()
            self.send_json_response(courses)
            return

        # 4a. Player Past Rounds History API
        if path.startswith("/api/players/") and path.endswith("/history"):
            ply_id = path.replace("/api/players/", "").replace("/history", "").strip("/")
            history = db.get_player_rounds_history(ply_id)
            self.send_json_response(history)
            return

        # 4b. Players Directory & Search API
        if path == "/api/players":
            params = urllib.parse.parse_qs(parsed.query)
            q = params.get("q", [None])[0]
            players_list = db.list_players(q)
            self.send_json_response(players_list)
            return

        # 5. User's Roster API (My Players)
        if path == "/api/my-players":
            if user_id:
                my_players = db.list_user_players(user_id)
            else:
                my_players = db.list_players()[:6]
            self.send_json_response(my_players)
            return

        # 6. Player Cash Stats API with Currency & Date Filter
        if path == "/api/players/stats":
            params = urllib.parse.parse_qs(parsed.query)
            r_type = params.get("range", ["all"])[0]
            s_date = params.get("start_date", params.get("start", [None]))[0]
            e_date = params.get("end_date", params.get("end", [None]))[0]
            curr = params.get("currency", ["THB"])[0]
            stats = db.get_players_stats(user_id, range_type=r_type, start_date=s_date, end_date=e_date, target_currency=curr)
            self.send_json_response(stats)
            return

        # 7. User's Rounds List API
        if path == "/api/rounds":
            if not user_id:
                self.send_json_response([])
            else:
                qs = urllib.parse.parse_qs(parsed.query)
                curr_rid = qs.get("current_round_id", [None])[0]
                if curr_rid:
                    curr_r = db.get_round(curr_rid)
                    if curr_r and not curr_r.get("owner_id"):
                        db.update_round(curr_rid, {"owner_id": user_id})
                rounds = db.list_user_rounds(user_id)
                self.send_json_response(rounds)
            return

        # Admin: Get accounts & players
        if path == "/api/admin/accounts":
            if not is_admin(user):
                self.send_json_response({"error": "Admin access required"}, status=403)
                return
            accounts = db.admin_get_accounts()
            self.send_json_response(accounts)
            return

        # Admin: Get all rounds
        if path == "/api/admin/all-rounds":
            if not is_admin(user):
                self.send_json_response({"error": "Admin access required"}, status=403)
                return
            rounds = db.admin_get_all_rounds()
            self.send_json_response(rounds)
            return

        # 8. Round State API: /api/round/<round_id> or legacy /api/tournament
        if path.startswith("/api/round/"):
            round_id = self.get_requested_round_id(parsed, user_id=user_id)
            state = round_manager.get_round_state(round_id, user_id)
            if not state:
                self.send_error(404, "Round Not Found")
                return
            self.send_json_response(state)
            return

        if path == "/api/tournament":
            round_id = self.get_requested_round_id(parsed, user_id=user_id)
            if not round_id:
                self.send_json_response({"round": None, "has_ongoing": False, "authenticated": bool(user_id)})
                return
            state = round_manager.get_round_state(round_id, user_id)
            if not state:
                self.send_json_response({"round": None, "has_ongoing": False, "authenticated": bool(user_id)})
                return
            self.send_json_response(state)
            return

        # 9. Server-Sent Events (SSE) Stream
        if path.startswith("/api/events") or path.startswith("/api/round/") and path.endswith("/events"):
            round_id = self.get_requested_round_id(parsed, user_id=user_id)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_cors_headers()
            self.end_headers()

            round_manager.add_subscriber(round_id, self)
            try:
                state = round_manager.get_round_state(round_id, user_id)
                init_payload = f"event: init\ndata: {json.dumps(state)}\n\n".encode("utf-8")
                self.wfile.write(init_payload)
                self.wfile.flush()

                while True:
                    time.sleep(15)
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                pass
            finally:
                round_manager.remove_subscriber(round_id, self)
            return

        # 7. Front-end SPA routing for /round/<round_id>
        if path.startswith("/round/"):
            index_path = os.path.join(FRONTEND_DIR, "index.html")
            self.serve_file(index_path)
            return

        # 8. Static frontend files
        if path == "/" or path == "":
            filepath = os.path.join(FRONTEND_DIR, "index.html")
        else:
            rel_path = path.lstrip("/")
            filepath = os.path.join(FRONTEND_DIR, rel_path)

        if os.path.exists(filepath) and os.path.isfile(filepath):
            self.serve_file(filepath)
        else:
            index_path = os.path.join(FRONTEND_DIR, "index.html")
            if os.path.exists(index_path):
                self.serve_file(index_path)
            else:
                self.send_error(404, "File Not Found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        user = self.get_current_user()
        user_id = user["id"] if user else None

        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            body = json.loads(post_body.decode("utf-8")) if post_body else {}
        except Exception:
            body = {}

        # 1. Auth Logout
        if path == "/api/logout":
            self.send_response(200)
            self.send_header("Set-Cookie", "session_token=; Path=/; HttpOnly; Max-Age=0")
            self.send_json_response({"authenticated": False})
            return

        # Player Profile & Linking APIs
        if path == "/api/me/link-player":
            if not user_id:
                self.send_json_response({"error": "Unauthorized"}, status=401)
                return
            ply_id = body.get("player_id")
            if not ply_id:
                self.send_json_response({"error": "player_id required"}, status=400)
                return
            linked = db.link_user_to_existing_player(user_id, ply_id, user.get("name", "Golfer"), user.get("email", ""))
            if not linked:
                self.send_json_response({"error": "Player not found"}, status=404)
                return
            self.send_json_response({"status": "ok", "player": linked})
            return

        if path == "/api/me/create-player":
            if not user_id:
                self.send_json_response({"error": "Unauthorized"}, status=401)
                return
            nick = (body.get("nickname") or "").strip()
            if not nick:
                self.send_json_response({"error": "Nickname is required"}, status=400)
                return
            try:
                hcp = float(body.get("current_handicap") or body.get("handicap") or 18.0)
            except Exception:
                hcp = 18.0
            parts = (user.get("name") or "").strip().split()
            first_name = parts[0] if parts else nick
            last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
            email = user.get("email")

            existing = db.check_player_exists(nick, first_name, last_name)
            if existing:
                # Link user to the existing matching player rather than failing or creating duplicate!
                linked = db.link_user_to_existing_player(user_id, existing["id"], user.get("name") or nick, email)
                self.send_json_response({"status": "ok", "player": linked})
                return

            new_p = db.create_player(nick, first_name, last_name, email=email, user_id=user_id, current_handicap=hcp)
            db.add_user_player(user_id, new_p["id"])
            self.send_json_response({"status": "ok", "player": new_p})
            return

        if path == "/api/me/player":
            if not user_id:
                self.send_json_response({"error": "Unauthorized"}, status=401)
                return
            linked_p = db.find_player_by_user_id(user_id)
            if not linked_p:
                self.send_json_response({"error": "No linked player profile found"}, status=404)
                return
            updated_p = db.update_player_profile(linked_p["id"], body)
            self.send_json_response({"status": "ok", "player": updated_p})
            return

        # Admin: Link account to player
        if path == "/api/admin/link":
            if not is_admin(user):
                self.send_json_response({"error": "Admin access required"}, status=403)
                return
            target_user_id = (body.get("user_id") or "").strip()
            target_player_id = (body.get("player_id") or "").strip()
            if not target_user_id or not target_player_id:
                self.send_json_response({"error": "user_id and player_id are required"}, status=400)
                return
            linked = db.admin_link_user_to_player(target_user_id, target_player_id)
            if not linked:
                self.send_json_response({"error": "User or Player not found"}, status=404)
                return
            self.send_json_response({"status": "ok", "player": linked})
            return

        # Admin: Unlink player account
        if path == "/api/admin/unlink":
            if not is_admin(user):
                self.send_json_response({"error": "Admin access required"}, status=403)
                return
            target_player_id = (body.get("player_id") or "").strip()
            if not target_player_id:
                self.send_json_response({"error": "player_id is required"}, status=400)
                return
            success = db.admin_unlink_player(target_player_id)
            self.send_json_response({"status": "ok", "success": success})
            return

        # Admin: Create Manual Round
        if path == "/api/admin/manual-rounds":
            if not is_admin(user):
                self.send_json_response({"error": "Admin access required"}, status=403)
                return
            c_id = body.get("course_id") or "course-krungthep-kreetha"
            tee_name = body.get("tee_name") or "White"
            date_str = body.get("date_str") or time.strftime("%Y-%m-%d")
            currency = body.get("currency") or "THB"
            players_data = body.get("players") or []
            if not players_data:
                self.send_json_response({"error": "At least one player is required"}, status=400)
                return
            rnd = db.admin_create_manual_round(
                admin_user_id=user["id"],
                course_id=c_id,
                tee_name=tee_name,
                date_str=date_str,
                currency=currency,
                players_data=players_data
            )
            self.send_json_response({"status": "ok", "round": rnd, "round_id": rnd["id"]})
            return

        # 2. Create New Round
        if path == "/api/rounds":
            course_id = body.get("course_id")
            new_r = round_manager.create_fresh_round(owner_id=user_id, course_id=course_id)
            state = round_manager.get_round_state(new_r["id"], user_id)
            self.send_json_response(state)
            return

        # 3. Create / Save Custom Course
        if path == "/api/courses" or (path == "/api/course" and body.get("is_new")):
            course_name = body.get("course_name") or "Custom Course"
            holes = body.get("holes") or DEFAULT_HOLES
            tees = body.get("tees") or DEFAULT_TEES
            new_c = db.create_course(course_name, holes, tees=tees)
            courses = db.list_courses()
            self.send_json_response({
                "courses": courses,
                "new_course_id": new_c["id"]
            })
            return

        # 4. Create New Global Player (with duplicate prevention)
        if path == "/api/players":
            nickname = (body.get("nickname") or "").strip()
            first_name = (body.get("first_name") or "").strip()
            last_name = (body.get("last_name") or "").strip()
            email = (body.get("email") or "").strip() or None
            try:
                hcp = float(body.get("current_handicap") or body.get("handicap") or 18.0)
            except Exception:
                hcp = 18.0

            if not nickname or not first_name or not last_name:
                self.send_json_response({"error": "Nickname, First Name, and Last Name are required."}, status=400)
                return

            existing = db.check_player_exists(nickname, first_name, last_name)
            if existing:
                self.send_json_response({
                    "error": f"A player with nickname '{nickname}' or name '{first_name} {last_name}' already exists in the players catalog."
                }, status=409)
                return

            linked_uid = user_id if (user and email and email.lower() == user.get("email", "").lower()) else None
            new_p = db.create_player(nickname, first_name, last_name, email=email, user_id=linked_uid, current_handicap=hcp)
            if user_id:
                db.add_user_player(user_id, new_p["id"])
            self.send_json_response(new_p)
            return

        # 5. Add Player to User Roster (My Players)
        if path == "/api/my-players":
            ply_id = body.get("player_id")
            if not ply_id:
                self.send_json_response({"error": "player_id required"}, status=400)
                return
            if user_id:
                db.add_user_player(user_id, ply_id)
            self.send_json_response({"status": "ok", "success": True})
            return

        # 6. Resolve round_id for round operations
        round_id = self.get_requested_round_id(parsed, user_id=user_id)

        # 5. Round Actions: finish & unlock
        if path == f"/api/round/{round_id}/finish" or (path == "/api/finish"):
            state = round_manager.finish_round(round_id, user_id)
            if state and "error" in state:
                self.send_json_response(state, status=403)
            else:
                self.send_json_response(state)
            return

        if path == f"/api/round/{round_id}/unlock" or (path == "/api/unlock"):
            result = round_manager.unlock_round(round_id, user_id)
            if result and "error" in result:
                self.send_json_response(result, status=403)
            else:
                self.send_json_response(result)
            return

        # 6. Score Entry
        if path == f"/api/round/{round_id}/score" or path == "/api/score":
            hole_num = int(body.get("hole", 1))
            score_data = body.get("scores")
            team_a = body.get("team_a")
            team_b = body.get("team_b")
            state = round_manager.set_hole_scores(round_id, hole_num, score_data, team_a=team_a, team_b=team_b, user_id=user_id)
            if state and "error" in state:
                self.send_json_response(state, status=403)
            else:
                self.send_json_response(state)
            return

        # 7. Settings Update
        if path == f"/api/round/{round_id}/settings" or path == "/api/settings":
            state = round_manager.update_settings(round_id, body, user_id=user_id)
            if state and "error" in state:
                self.send_json_response(state, status=403)
            else:
                self.send_json_response(state)
            return

        # 8. Players Update
        if path == f"/api/round/{round_id}/players" or path == "/api/players":
            players_list = body.get("players", [])
            state = round_manager.update_players(round_id, players_list, user_id=user_id)
            if state and "error" in state:
                self.send_json_response(state, status=403)
            else:
                self.send_json_response(state)
            return

        # 9. Course Update for Round
        if path == f"/api/round/{round_id}/course" or path == "/api/course":
            state = round_manager.update_course(round_id, body, user_id=user_id)
            if state and "error" in state:
                self.send_json_response(state, status=403)
            else:
                self.send_json_response(state)
            return

        # 10. Reset Round Scores
        if path == f"/api/round/{round_id}/reset" or path == "/api/reset":
            state = round_manager.reset_round_scores(round_id, user_id=user_id)
            if state and "error" in state:
                self.send_json_response(state, status=403)
            else:
                self.send_json_response(state)
            return

        self.send_error(404, "Endpoint Not Found")

    def do_PUT(self):
        self.do_POST()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        user = self.get_current_user()
        user_id = user["id"] if user else None

        # 1. Remove player from user roster
        if path.startswith("/api/my-players/"):
            ply_id = path.replace("/api/my-players/", "").strip("/")
            if ply_id and user_id:
                db.remove_user_player(user_id, ply_id)
            self.send_json_response({"status": "ok", "success": True})
            return

        # Admin: Delete player permanently
        if path.startswith("/api/admin/players/"):
            if not is_admin(user):
                self.send_json_response({"error": "Admin access required"}, status=403)
                return
            target_pid = path.replace("/api/admin/players/", "").strip("/")
            if target_pid:
                db.admin_delete_player(target_pid)
            self.send_json_response({"status": "ok", "success": True})
            return

        # Admin: Delete any round permanently
        if path.startswith("/api/admin/rounds/"):
            if not is_admin(user):
                self.send_json_response({"error": "Admin access required"}, status=403)
                return
            target_rid = path.replace("/api/admin/rounds/", "").strip("/")
            if target_rid:
                db.delete_round(target_rid)
            self.send_json_response({"status": "ok", "success": True})
            return

        # 2. Delete Round
        round_id = self.get_requested_round_id(parsed, user_id=user_id)
        if path == f"/api/round/{round_id}" or path.startswith("/api/round/"):
            round_data = db.get_round(round_id)
            if not round_data:
                self.send_error(404, "Round Not Found")
                return
            if round_data.get("owner_id") and user_id != round_data.get("owner_id"):
                self.send_json_response({"error": "Only the round creator can delete this round"}, status=403)
                return
            db.delete_round(round_id)
            self.send_json_response({"status": "ok", "success": True, "deleted_round_id": round_id})
            return

        self.send_error(404, "Endpoint Not Found")

    def send_json_response(self, data: Any, status: int = 200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _get_content_type(self, filepath: str) -> str:
        ext = os.path.splitext(filepath)[1].lower()
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon"
        }
        return types.get(ext, "application/octet-stream")

    def serve_file(self, filepath: str):
        content_type = self._get_content_type(filepath)
        try:
            with open(filepath, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            pass


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        exc_type, exc_val, exc_tb = sys.exc_info()
        if exc_type and issubclass(exc_type, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        if isinstance(exc_val, OSError) and getattr(exc_val, 'errno', None) in (10053, 10054, 32, 104, 10038):
            return
        super().handle_error(request, client_address)


def run_server(port=PORT):
    server = ThreadedHTTPServer(("0.0.0.0", port), SundayGolfRequestHandler)
    print(f"⛳ [Sunday Golf Tracker Server] Running at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()


if __name__ == "__main__":
    run_server(PORT)
