"""
Sunday Golf Tracker - Real-Time HTTP & Server-Sent Events (SSE) Server
Python 3 standard library only.
"""

import http.server
import socketserver
import json
import os
import sys
import time
import copy
import threading
from urllib.parse import urlparse
from typing import Dict, List, Any, Optional

from engine import (
    calculate_tournament_state,
    DEFAULT_PLAYERS,
    DEFAULT_HOLES,
    DEFAULT_SETTINGS,
    DEFAULT_PLAYER_COLORS,
    DEFAULT_PLAYER_NAMES
)

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
DATA_FILE = os.path.join(PROJECT_DIR, "data", "tournament_state.json")
COURSES_FILE = os.path.join(PROJECT_DIR, "data", "courses.json")
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
UPLOADS_DIR = os.path.join(FRONTEND_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

INITIAL_DATA = {
    "tournament_name": "Sunday Golf Match",
    "course_id": "course-krungthep-kreetha",
    "course_name": "Krungthep Kreetha Golf Course",
    "game_settings": DEFAULT_SETTINGS,
    "players": DEFAULT_PLAYERS,
    "holes": DEFAULT_HOLES,
    "scores": {}
}


def load_courses_database() -> List[Dict[str, Any]]:
    if os.path.exists(COURSES_FILE):
        try:
            with open(COURSES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[COURSES] Error loading {COURSES_FILE}: {e}")
    return []


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


class TournamentStore:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.lock = threading.Lock()
        self.subscribers: List[http.server.BaseHTTPRequestHandler] = []
        self.subscribers_lock = threading.Lock()
        self.data = self._load()

    def _load(self) -> Dict[str, Any]:
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    if "players" not in loaded or not loaded["players"]:
                        loaded["players"] = copy.deepcopy(DEFAULT_PLAYERS)
                    if "game_settings" not in loaded:
                        loaded["game_settings"] = copy.deepcopy(DEFAULT_SETTINGS)
                    if "holes" not in loaded or not loaded["holes"]:
                        loaded["holes"] = copy.deepcopy(DEFAULT_HOLES)

                    valid_ids = set(p["id"] for p in loaded["players"])
                    if "scores" in loaded and isinstance(loaded["scores"], dict):
                        loaded["scores"] = sanitize_scores_with_players(loaded["scores"], valid_ids)

                    return loaded
            except Exception as e:
                print(f"[STORE] Error reading {self.filepath}: {e}, using initial data.")
        self._save(INITIAL_DATA)
        return copy_dict(INITIAL_DATA)

    def _save(self, data: Dict[str, Any]):
        os.makedirs(os.path.dirname(self.filepath), exist_ok=True)
        with open(self.filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get_state(self) -> Dict[str, Any]:
        with self.lock:
            return calculate_tournament_state(self.data)

    def get_raw_data(self) -> Dict[str, Any]:
        with self.lock:
            return copy_dict(self.data)

    def set_hole_scores(self, hole_num: int, score_data: Optional[Dict[str, Any]], team_a: Optional[List[str]] = None, team_b: Optional[List[str]] = None) -> Dict[str, Any]:
        with self.lock:
            valid_ids = set(p["id"] for p in self.data.get("players", []))
            h_key = str(hole_num)
            if "scores" not in self.data:
                self.data["scores"] = {}

            if score_data is None or len(score_data) == 0:
                self.data["scores"].pop(h_key, None)
            else:
                current_entry = self.data["scores"].setdefault(h_key, {})
                if "scores" not in current_entry:
                    current_entry["scores"] = {}
                clean_scores = {pid: v for pid, v in score_data.items() if pid in valid_ids}
                current_entry["scores"].update(clean_scores)

                if team_a is not None:
                    current_entry["team_a"] = [pid for pid in team_a if pid in valid_ids]
                if team_b is not None:
                    current_entry["team_b"] = [pid for pid in team_b if pid in valid_ids]

            self.data["last_updated"] = time.time()
            self._save(self.data)
            state = calculate_tournament_state(self.data)

        self.broadcast_event("score_update", state)
        return state

    def update_players(self, players_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        with self.lock:
            clean_players = []
            for idx, p in enumerate(players_list):
                if idx >= 6:
                    break
                p_id = p.get("id") or f"p{idx+1}"
                p_name = p.get("name") or DEFAULT_PLAYER_NAMES[min(idx, len(DEFAULT_PLAYER_NAMES)-1)]
                p_color = p.get("color") or DEFAULT_PLAYER_COLORS[min(idx, len(DEFAULT_PLAYER_COLORS)-1)]
                p_out = int(p.get("hcp_out", 0) or 0)
                p_in = int(p.get("hcp_in", 0) or 0)
                clean_players.append({
                    "id": p_id,
                    "name": p_name,
                    "color": p_color,
                    "hcp_out": max(0, p_out),
                    "hcp_in": max(0, p_in)
                })

            while len(clean_players) < 3:
                idx = len(clean_players)
                clean_players.append({
                    "id": f"p{idx+1}",
                    "name": DEFAULT_PLAYER_NAMES[min(idx, len(DEFAULT_PLAYER_NAMES)-1)],
                    "color": DEFAULT_PLAYER_COLORS[min(idx, len(DEFAULT_PLAYER_COLORS)-1)],
                    "hcp_out": 0,
                    "hcp_in": 0
                })

            self.data["players"] = clean_players
            valid_ids = set(p["id"] for p in clean_players)

            # Sanitize scores
            if "scores" in self.data and isinstance(self.data["scores"], dict):
                self.data["scores"] = sanitize_scores_with_players(self.data["scores"], valid_ids)

            self.data["last_updated"] = time.time()
            self._save(self.data)
            state = calculate_tournament_state(self.data)

        self.broadcast_event("players_update", state)
        return state

    def update_settings(self, settings_payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            if "tournament_name" in settings_payload:
                self.data["tournament_name"] = str(settings_payload["tournament_name"]).strip()
            
            game_settings_in = settings_payload.get("game_settings") or settings_payload
            current_settings = self.data.setdefault("game_settings", copy.deepcopy(DEFAULT_SETTINGS))
            
            for k in [
                "game_mode", "hand_count", "cash_per_point", "currency",
                "turbo", "turbo_multiplier", "turbo_handicap", "penetrate",
                "penetrate_bonus", "birdie_point", "eagle_point", "albatross_point"
            ]:
                if k in game_settings_in:
                    current_settings[k] = game_settings_in[k]

            self.data["last_updated"] = time.time()
            self._save(self.data)
            state = calculate_tournament_state(self.data)

        self.broadcast_event("settings_update", state)
        return state

    def update_course(self, course_payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            if "course_id" in course_payload:
                self.data["course_id"] = course_payload["course_id"]
            if "course_name" in course_payload:
                self.data["course_name"] = course_payload["course_name"]

            holes_in = course_payload.get("holes")
            if holes_in and isinstance(holes_in, list):
                clean_holes = []
                for h in holes_in:
                    clean_holes.append({
                        "hole": int(h.get("hole", 1)),
                        "par": int(h.get("par", 4)),
                        "handicap": int(h.get("handicap", 9)),
                        "is_turbo": bool(h.get("is_turbo", False))
                    })
                self.data["holes"] = clean_holes

            self.data["last_updated"] = time.time()
            self._save(self.data)
            state = calculate_tournament_state(self.data)

        self.broadcast_event("course_update", state)
        return state

    def reset_scores(self) -> Dict[str, Any]:
        with self.lock:
            self.data["scores"] = {}
            self.data["last_updated"] = time.time()
            self._save(self.data)
            state = calculate_tournament_state(self.data)

        self.broadcast_event("reset", state)
        return state

    def reset_to_default(self) -> Dict[str, Any]:
        with self.lock:
            self.data = copy_dict(INITIAL_DATA)
            self.data["last_updated"] = time.time()
            self._save(self.data)
            state = calculate_tournament_state(self.data)

        self.broadcast_event("reset_default", state)
        return state

    def register_subscriber(self, handler):
        with self.subscribers_lock:
            self.subscribers.append(handler)

    def remove_subscriber(self, handler):
        with self.subscribers_lock:
            if handler in self.subscribers:
                self.subscribers.remove(handler)

    def broadcast_event(self, event_type: str, data: Dict[str, Any]):
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n".encode("utf-8")
        dead_clients = []
        with self.subscribers_lock:
            for client in self.subscribers:
                try:
                    client.wfile.write(payload)
                    client.wfile.flush()
                except Exception:
                    dead_clients.append(client)
            for dc in dead_clients:
                if dc in self.subscribers:
                    self.subscribers.remove(dc)


store = TournamentStore(DATA_FILE)


class SundayGolfRequestHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError):
            pass
        except OSError as e:
            if e.errno in (10053, 10054, 32, 104):
                pass
            else:
                raise

    def finish(self):
        try:
            if not self.wfile.closed:
                self.wfile.flush()
        except Exception:
            pass
        try:
            self.wfile.close()
        except Exception:
            pass
        try:
            self.rfile.close()
        except Exception:
            pass

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_cors_headers()
            self.end_headers()

            initial_state = store.get_state()
            init_msg = f"event: initial\ndata: {json.dumps(initial_state)}\n\n".encode("utf-8")
            try:
                self.wfile.write(init_msg)
                self.wfile.flush()
            except Exception:
                return

            store.register_subscriber(self)
            try:
                while True:
                    time.sleep(15)
                    ping_msg = f": heartbeat\n\n".encode("utf-8")
                    self.wfile.write(ping_msg)
                    self.wfile.flush()
            except Exception:
                pass
            finally:
                store.remove_subscriber(self)
            return

        if path == "/api/tournament":
            state = store.get_state()
            self.send_json_response(state)
            return

        if path == "/api/courses":
            courses = load_courses_database()
            self.send_json_response(courses)
            return

        if path == "/api/export":
            raw = store.get_raw_data()
            self.send_json_response(raw)
            return

        # Serve static frontend files
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
        parsed = urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            body = json.loads(post_body.decode("utf-8")) if post_body else {}
        except Exception:
            body = {}

        if path == "/api/score":
            hole_num = int(body.get("hole", 1))
            score_data = body.get("scores")
            team_a = body.get("team_a")
            team_b = body.get("team_b")
            state = store.set_hole_scores(hole_num, score_data, team_a=team_a, team_b=team_b)
            self.send_json_response(state)
            return

        if path == "/api/players":
            players_list = body.get("players", [])
            state = store.update_players(players_list)
            self.send_json_response(state)
            return

        if path == "/api/settings":
            state = store.update_settings(body)
            self.send_json_response(state)
            return

        if path == "/api/course":
            state = store.update_course(body)
            self.send_json_response(state)
            return

        if path == "/api/reset":
            state = store.reset_scores()
            self.send_json_response(state)
            return

        if path == "/api/reset_default":
            state = store.reset_to_default()
            self.send_json_response(state)
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

    def serve_file(self, filepath: str):
        content_type = "text/plain"
        if filepath.endswith(".html"):
            content_type = "text/html"
        elif filepath.endswith(".js"):
            content_type = "application/javascript"
        elif filepath.endswith(".css"):
            content_type = "text/css"
        elif filepath.endswith(".json"):
            content_type = "application/json"
        elif filepath.endswith(".png"):
            content_type = "image/png"
        elif filepath.endswith(".jpg") or filepath.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filepath.endswith(".svg"):
            content_type = "image/svg+xml"
        elif filepath.endswith(".webp"):
            content_type = "image/webp"

        with open(filepath, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_cors_headers()
        self.end_headers()
        try:
            self.wfile.write(content)
        except Exception:
            pass


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        """
        Suppress harmless client disconnect/abort errors from browser reloads/speculative connections.
        """
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
    env_port = os.environ.get("PORT")
    if env_port:
        port = int(env_port)
    elif len(sys.argv) > 1:
        port = int(sys.argv[1])
    else:
        port = PORT
    run_server(port)
