"""
Sunday Golf Tracker - Database Layer
Hybrid PostgreSQL (Production on Railway) & SQLite (Local fallback)
Supports multi-tenant rounds, shared course catalogs, user accounts,
persistent players catalog, WHS handicap tracking, and multi-currency stats.
"""

import os
import sys
import json
import time
import re
import sqlite3
from typing import Dict, List, Any, Optional

DATABASE_URL = os.environ.get("DATABASE_URL")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(PROJECT_DIR, "data")
SQLITE_DB_PATH = os.path.join(DATA_DIR, "golf_tracker.db")
COURSES_JSON_PATH = os.path.join(DATA_DIR, "courses.json")

# Determine DB driver
IS_POSTGRES = False
if DATABASE_URL and (DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")):
    try:
        import psycopg2
        import psycopg2.extras
        IS_POSTGRES = True
    except ImportError:
        print("[DB WARNING] DATABASE_URL provided but psycopg2 not installed. Falling back to SQLite.")
        IS_POSTGRES = False


DEFAULT_TEES = [
    {"id": "red", "name": "Red", "color": "#EF4444", "course_rating": 68.4, "slope_rating": 118},
    {"id": "yellow", "name": "Yellow", "color": "#EAB308", "course_rating": 70.1, "slope_rating": 122},
    {"id": "white", "name": "White", "color": "#F8FAFC", "course_rating": 71.5, "slope_rating": 126},
    {"id": "blue", "name": "Blue", "color": "#3B82F6", "course_rating": 73.0, "slope_rating": 131},
    {"id": "black", "name": "Black", "color": "#0F172A", "course_rating": 74.8, "slope_rating": 137}
]

CURRENCY_RATES_TO_THB = {
    "THB": 1.0,
    "USD": 35.5,
    "EUR": 38.5,
    "GBP": 45.0,
    "SGD": 26.5,
    "JPY": 0.235,
    "AUD": 23.0
}

def convert_currency(amount: float, from_curr: str, to_curr: str) -> float:
    from_curr = (from_curr or "THB").upper()
    to_curr = (to_curr or "THB").upper()
    if from_curr == to_curr:
        return float(amount)
    rate_from = CURRENCY_RATES_TO_THB.get(from_curr, 1.0)
    rate_to = CURRENCY_RATES_TO_THB.get(to_curr, 1.0)
    thb_val = float(amount) * rate_from
    return thb_val / rate_to


class Database:
    def __init__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        self.is_postgres = IS_POSTGRES
        self.init_schema()
        self.seed_courses_if_empty()
        self.seed_players_if_empty()

    def get_connection(self):
        if self.is_postgres:
            dsn = DATABASE_URL
            if dsn.startswith("postgres://"):
                dsn = dsn.replace("postgres://", "postgresql://", 1)
            conn = psycopg2.connect(dsn)
            conn.autocommit = True
            return conn
        else:
            conn = sqlite3.connect(SQLITE_DB_PATH, timeout=20.0)
            conn.row_factory = sqlite3.Row
            return conn

    def _execute(self, query: str, params: tuple = ()):
        conn = self.get_connection()
        try:
            cur = conn.cursor()
            if self.is_postgres:
                pg_query = query.replace("?", "%s")
                cur.execute(pg_query, params)
                return cur, conn
            else:
                cur.execute(query, params)
                conn.commit()
                return cur, conn
        except Exception:
            conn.close()
            raise

    def query_all(self, query: str, params: tuple = ()) -> List[Dict[str, Any]]:
        cur, conn = self._execute(query, params)
        try:
            if self.is_postgres:
                cols = [desc[0] for desc in cur.description] if cur.description else []
                rows = cur.fetchall()
                return [dict(zip(cols, row)) for row in rows]
            else:
                rows = cur.fetchall()
                return [dict(row) for row in rows]
        finally:
            cur.close()
            conn.close()

    def query_one(self, query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        cur, conn = self._execute(query, params)
        try:
            if self.is_postgres:
                row = cur.fetchone()
                if not row:
                    return None
                cols = [desc[0] for desc in cur.description]
                return dict(zip(cols, row))
            else:
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            cur.close()
            conn.close()

    def execute(self, query: str, params: tuple = ()) -> None:
        cur, conn = self._execute(query, params)
        cur.close()
        conn.close()

    def init_schema(self):
        """Initializes tables for Users, Courses, Rounds, Players, and Differential History"""
        users_table = """
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(255) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            picture TEXT,
            created_at REAL
        );
        """

        courses_table = """
        CREATE TABLE IF NOT EXISTS courses (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            location VARCHAR(255),
            holes TEXT,
            tees TEXT,
            created_at REAL
        );
        """

        rounds_table = """
        CREATE TABLE IF NOT EXISTS rounds (
            id VARCHAR(255) PRIMARY KEY,
            owner_id VARCHAR(255),
            name VARCHAR(255) NOT NULL,
            course_id VARCHAR(255),
            course_name VARCHAR(255),
            starting_hole INTEGER DEFAULT 1,
            is_finished INTEGER DEFAULT 0,
            selected_tee TEXT,
            game_settings TEXT,
            players TEXT,
            holes TEXT,
            scores TEXT,
            created_at REAL,
            updated_at REAL
        );
        """

        players_table = """
        CREATE TABLE IF NOT EXISTS players (
            id VARCHAR(255) PRIMARY KEY,
            nickname VARCHAR(255) NOT NULL,
            first_name VARCHAR(255) NOT NULL,
            last_name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            user_id VARCHAR(255),
            current_handicap REAL DEFAULT 18.0,
            created_at REAL,
            updated_at REAL
        );
        """

        user_players_table = """
        CREATE TABLE IF NOT EXISTS user_players (
            user_id VARCHAR(255) NOT NULL,
            player_id VARCHAR(255) NOT NULL,
            created_at REAL,
            PRIMARY KEY (user_id, player_id)
        );
        """

        history_table = """
        CREATE TABLE IF NOT EXISTS player_round_history (
            id VARCHAR(255) PRIMARY KEY,
            player_id VARCHAR(255) NOT NULL,
            round_id VARCHAR(255) NOT NULL,
            round_date VARCHAR(64) NOT NULL,
            gross_score INTEGER NOT NULL,
            course_rating REAL NOT NULL,
            slope_rating REAL NOT NULL,
            differential REAL NOT NULL,
            created_at REAL
        );
        """

        for q in [users_table, courses_table, rounds_table, players_table, user_players_table, history_table]:
            self.execute(q)

        # Migration column safety for existing databases
        for alter_q in [
            "ALTER TABLE courses ADD COLUMN tees TEXT;",
            "ALTER TABLE rounds ADD COLUMN selected_tee TEXT;"
        ]:
            try:
                self.execute(alter_q)
            except Exception:
                pass

        # Clean up any dummy seed players ('PLAYER 1' .. 'PLAYER 6')
        try:
            self.execute("DELETE FROM user_players WHERE player_id IN ('ply-p1', 'ply-p2', 'ply-p3', 'ply-p4', 'ply-p5', 'ply-p6');")
            self.execute("DELETE FROM players WHERE id IN ('ply-p1', 'ply-p2', 'ply-p3', 'ply-p4', 'ply-p5', 'ply-p6') OR nickname LIKE 'PLAYER %';")
        except Exception:
            pass

        db_type = "PostgreSQL" if self.is_postgres else f"SQLite ({SQLITE_DB_PATH})"
        print(f"[DB INIT] Database initialized successfully using {db_type}")

    def seed_courses_if_empty(self):
        """Pre-populates the courses table from courses.json if empty"""
        existing = self.query_one("SELECT COUNT(*) as cnt FROM courses;")
        count = existing.get("cnt", 0) if existing else 0
        if count == 0 and os.path.exists(COURSES_JSON_PATH):
            try:
                with open(COURSES_JSON_PATH, "r", encoding="utf-8") as f:
                    courses = json.load(f)
                now = time.time()
                for c in courses:
                    c_id = c.get("id")
                    c_name = c.get("name")
                    c_loc = c.get("location", "Thailand")
                    c_holes = json.dumps(c.get("holes", []))
                    c_tees = json.dumps(c.get("tees") or DEFAULT_TEES)
                    self.execute(
                        "INSERT INTO courses (id, name, location, holes, tees, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (c_id, c_name, c_loc, c_holes, c_tees, now)
                    )
                print(f"[DB SEED] Seeded {len(courses)} courses from courses.json into SQL database.")
            except Exception as e:
                print(f"[DB SEED ERROR] Failed to seed courses: {e}")

    def seed_players_if_empty(self):
        """No dummy players pre-seeded; directory starts clean for user-created players."""
        pass

    # ================= USER CRUD =================
    def upsert_user(self, user_id: str, email: str, name: str, picture: Optional[str] = None) -> Dict[str, Any]:
        existing = self.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
        now = time.time()
        if existing:
            self.execute(
                "UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?",
                (email, name, picture or "", user_id)
            )
        else:
            self.execute(
                "INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email, name, picture or "", now)
            )
        user = self.get_user(user_id) or {"id": user_id, "email": email, "name": name, "picture": picture}
        self.link_user_to_player(user_id, email, name)
        return user

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self.query_one("SELECT * FROM users WHERE id = ?", (user_id,))

    # ================= COURSES CRUD =================
    def list_courses(self) -> List[Dict[str, Any]]:
        rows = self.query_all("SELECT * FROM courses ORDER BY name ASC")
        for r in rows:
            if isinstance(r.get("holes"), str):
                try:
                    r["holes"] = json.loads(r["holes"])
                except Exception:
                    r["holes"] = []
            if isinstance(r.get("tees"), str):
                try:
                    r["tees"] = json.loads(r["tees"])
                except Exception:
                    r["tees"] = DEFAULT_TEES
            if not r.get("tees"):
                r["tees"] = DEFAULT_TEES
        return rows

    def get_course(self, course_id: str) -> Optional[Dict[str, Any]]:
        row = self.query_one("SELECT * FROM courses WHERE id = ?", (course_id,))
        if row:
            if isinstance(row.get("holes"), str):
                try:
                    row["holes"] = json.loads(row["holes"])
                except Exception:
                    row["holes"] = []
            if isinstance(row.get("tees"), str):
                try:
                    row["tees"] = json.loads(row["tees"])
                except Exception:
                    row["tees"] = DEFAULT_TEES
            if not row.get("tees"):
                row["tees"] = DEFAULT_TEES
        return row

    def create_course(self, course_name: str, holes: List[Dict[str, Any]], location: str = "Custom", tees: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        slug = re.sub(r'[^a-zA-Z0-9]+', '-', course_name.lower()).strip('-')
        if not slug:
            slug = "custom-course"
        course_id = f"course-{slug}-{int(time.time())}"
        now = time.time()
        holes_json = json.dumps(holes)
        tees_json = json.dumps(tees or DEFAULT_TEES)

        self.execute(
            "INSERT INTO courses (id, name, location, holes, tees, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (course_id, course_name, location, holes_json, tees_json, now)
        )
        return {
            "id": course_id,
            "name": course_name,
            "location": location,
            "holes": holes,
            "tees": tees or DEFAULT_TEES,
            "created_at": now
        }

    def update_course(self, course_id: str, course_name: str, holes: List[Dict[str, Any]], tees: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        now = time.time()
        if tees is not None:
            self.execute(
                "UPDATE courses SET name = ?, holes = ?, tees = ? WHERE id = ?",
                (course_name, json.dumps(holes), json.dumps(tees), course_id)
            )
        else:
            self.execute(
                "UPDATE courses SET name = ?, holes = ? WHERE id = ?",
                (course_name, json.dumps(holes), course_id)
            )
        return self.get_course(course_id)

    # ================= ROUNDS CRUD =================
    def find_rounds_by_name_prefix(self, prefix: str) -> List[Dict[str, Any]]:
        return self.query_all("SELECT id, name FROM rounds WHERE name LIKE ? ORDER BY created_at ASC", (f"{prefix}%",))

    def create_round(self, round_data: Dict[str, Any], owner_id: Optional[str] = None) -> Dict[str, Any]:
        now = time.time()
        r_id = round_data.get("id") or f"r-{int(now)}-{os.urandom(3).hex()}"
        
        c_name = round_data.get("course_name") or "Krungthep Kreetha Golf Course"
        date_str = time.strftime("%Y-%m-%d", time.localtime(now))

        # Auto-name format: YYYY-MM-DD [Course Name] - [Creator First Name]
        creator_first = "Guest"
        if owner_id:
            user = self.get_user(owner_id)
            if user:
                parts = (user.get("name") or "").strip().split()
                creator_first = parts[0] if parts else "Golfer"
                p_rec = self.find_player_by_user_id(owner_id)
                if p_rec and p_rec.get("first_name"):
                    creator_first = p_rec["first_name"]

        base_name = f"{date_str} {c_name} - {creator_first}"
        if not round_data.get("name"):
            existing = self.find_rounds_by_name_prefix(base_name)
            if not existing:
                name = base_name
            else:
                name = f"{base_name} {len(existing) + 1}"
        else:
            name = round_data["name"]

        course_id = round_data.get("course_id") or "course-krungthep-kreetha"
        starting_hole = int(round_data.get("starting_hole") or 1)
        is_finished = 1 if round_data.get("is_finished") else 0
        selected_tee = json.dumps(round_data.get("selected_tee") or DEFAULT_TEES[2])

        game_settings = json.dumps(round_data.get("game_settings") or {})
        players = json.dumps(round_data.get("players") or [])
        holes = json.dumps(round_data.get("holes") or [])
        scores = json.dumps(round_data.get("scores") or {})

        self.execute(
            """
            INSERT INTO rounds 
            (id, owner_id, name, course_id, course_name, starting_hole, is_finished, selected_tee, game_settings, players, holes, scores, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (r_id, owner_id, name, course_id, c_name, starting_hole, is_finished, selected_tee, game_settings, players, holes, scores, now, now)
        )
        return self.get_round(r_id)  # type: ignore

    def get_round(self, round_id: str) -> Optional[Dict[str, Any]]:
        row = self.query_one("SELECT * FROM rounds WHERE id = ?", (round_id,))
        if not row:
            return None
        # Parse JSON fields
        for field in ["game_settings", "players", "holes", "scores"]:
            if isinstance(row.get(field), str):
                try:
                    row[field] = json.loads(row[field])
                except Exception:
                    row[field] = {} if field in ["game_settings", "scores"] else []
        if isinstance(row.get("selected_tee"), str):
            try:
                row["selected_tee"] = json.loads(row["selected_tee"])
            except Exception:
                row["selected_tee"] = DEFAULT_TEES[2]
        if not row.get("selected_tee"):
            row["selected_tee"] = DEFAULT_TEES[2]

        row["is_finished"] = bool(row.get("is_finished", 0))
        return row

    def list_user_rounds(self, user_id: str) -> List[Dict[str, Any]]:
        linked_p = self.find_player_by_user_id(user_id)
        ply_id = linked_p["id"] if linked_p else None

        rows = self.query_all("SELECT * FROM rounds ORDER BY updated_at DESC")
        user_rounds = []
        for r in rows:
            is_owner = (r.get("owner_id") == user_id)
            is_player = False

            p_data = r.get("players")
            if isinstance(p_data, str):
                try:
                    p_data = json.loads(p_data)
                except Exception:
                    p_data = []
            if ply_id and isinstance(p_data, list):
                is_player = any(p.get("player_id") == ply_id or p.get("id") == ply_id for p in p_data)

            if is_owner or is_player:
                for field in ["game_settings", "players", "holes", "scores"]:
                    if isinstance(r.get(field), str):
                        try:
                            r[field] = json.loads(r[field])
                        except Exception:
                            r[field] = {} if field in ["game_settings", "scores"] else []
                if isinstance(r.get("selected_tee"), str):
                    try:
                        r["selected_tee"] = json.loads(r["selected_tee"])
                    except Exception:
                        r["selected_tee"] = DEFAULT_TEES[2]
                r["is_finished"] = bool(r.get("is_finished", 0))
                r["is_owner"] = is_owner
                user_rounds.append(r)
        return user_rounds

    def get_latest_round(self) -> Optional[Dict[str, Any]]:
        row = self.query_one("SELECT * FROM rounds ORDER BY updated_at DESC LIMIT 1")
        if not row:
            return None
        return self.get_round(row["id"])

    def get_latest_active_round(self, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Returns the latest unfinished round for user (as owner or lineup player)"""
        if not user_id:
            return None
        linked_p = self.find_player_by_user_id(user_id)
        ply_id = linked_p["id"] if linked_p else None

        rows = self.query_all("SELECT * FROM rounds WHERE is_finished = 0 ORDER BY updated_at DESC")
        for r in rows:
            if r.get("owner_id") == user_id:
                return self.get_round(r["id"])
            if ply_id:
                p_str = r.get("players")
                if isinstance(p_str, str) and ply_id in p_str:
                    return self.get_round(r["id"])
        return None

    def update_round(self, round_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        existing = self.get_round(round_id)
        if not existing:
            return None

        now = time.time()
        name = updates.get("name", existing.get("name"))
        course_id = updates.get("course_id", existing.get("course_id"))
        course_name = updates.get("course_name", existing.get("course_name"))
        starting_hole = int(updates.get("starting_hole", existing.get("starting_hole", 1)))
        
        is_finished = 1 if updates.get("is_finished", existing.get("is_finished")) else 0
        selected_tee = json.dumps(updates.get("selected_tee", existing.get("selected_tee") or DEFAULT_TEES[2]))
        game_settings = json.dumps(updates.get("game_settings", existing.get("game_settings", {})))
        players = json.dumps(updates.get("players", existing.get("players", [])))
        holes = json.dumps(updates.get("holes", existing.get("holes", [])))
        scores = json.dumps(updates.get("scores", existing.get("scores", {})))

        self.execute(
            """
            UPDATE rounds SET
                name = ?,
                course_id = ?,
                course_name = ?,
                starting_hole = ?,
                is_finished = ?,
                selected_tee = ?,
                game_settings = ?,
                players = ?,
                holes = ?,
                scores = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (name, course_id, course_name, starting_hole, is_finished, selected_tee, game_settings, players, holes, scores, now, round_id)
        )
        return self.get_round(round_id)

    def set_round_finished(self, round_id: str, finished: bool) -> Optional[Dict[str, Any]]:
        now = time.time()
        val = 1 if finished else 0
        self.execute("UPDATE rounds SET is_finished = ?, updated_at = ? WHERE id = ?", (val, now, round_id))
        return self.get_round(round_id)

    def delete_round(self, round_id: str) -> bool:
        self.execute("DELETE FROM rounds WHERE id = ?", (round_id,))
        return True

    # ================= PLAYERS & USER_PLAYERS CRUD =================
    def list_players(self, query: Optional[str] = None) -> List[Dict[str, Any]]:
        if query and query.strip():
            q = f"%{query.strip().lower()}%"
            rows = self.query_all(
                "SELECT * FROM players WHERE LOWER(nickname) LIKE ? OR LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(email) LIKE ? ORDER BY nickname ASC",
                (q, q, q, q)
            )
        else:
            rows = self.query_all("SELECT * FROM players ORDER BY nickname ASC")
        return rows

    def get_player(self, player_id: str) -> Optional[Dict[str, Any]]:
        return self.query_one("SELECT * FROM players WHERE id = ?", (player_id,))

    def find_player_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        if not email:
            return None
        return self.query_one("SELECT * FROM players WHERE LOWER(email) = LOWER(?)", (email.strip(),))

    def find_player_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        if not user_id:
            return None
        return self.query_one("SELECT * FROM players WHERE user_id = ?", (user_id,))

    def find_player_by_nickname_or_name(self, nickname: str, first_name: str = "", last_name: str = "") -> Optional[Dict[str, Any]]:
        row = self.query_one("SELECT * FROM players WHERE LOWER(nickname) = LOWER(?)", (nickname.strip(),))
        if row:
            return row
        if first_name and last_name:
            return self.query_one("SELECT * FROM players WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)", (first_name.strip(), last_name.strip()))
        return None

    def check_player_exists(self, nickname: str, first_name: str, last_name: str) -> Optional[Dict[str, Any]]:
        nick = (nickname or "").strip().lower()
        fn = (first_name or "").strip().lower()
        ln = (last_name or "").strip().lower()
        row = self.query_one(
            "SELECT * FROM players WHERE LOWER(nickname) = ? OR (LOWER(first_name) = ? AND LOWER(last_name) = ?)",
            (nick, fn, ln)
        )
        return row

    def create_player(self, nickname: str, first_name: str, last_name: str, email: Optional[str] = None, user_id: Optional[str] = None, current_handicap: float = 18.0) -> Dict[str, Any]:
        now = time.time()
        p_id = f"ply-{int(now)}-{os.urandom(3).hex()}"
        em = email.strip() if email else None
        hcp = round(float(current_handicap), 1)

        self.execute(
            "INSERT INTO players (id, nickname, first_name, last_name, email, user_id, current_handicap, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (p_id, nickname.strip(), first_name.strip(), last_name.strip(), em, user_id, hcp, now, now)
        )
        return self.get_player(p_id)  # type: ignore

    def link_user_to_player(self, user_id: str, email: str, name: str) -> Optional[Dict[str, Any]]:
        """Ensures a user is linked 1:1 to a player profile, overwriting first/last name with Google credentials"""
        if not email:
            return None
        p = self.find_player_by_email(email)
        now = time.time()
        parts = name.strip().split()
        first_name = parts[0] if parts else name
        last_name = " ".join(parts[1:]) if len(parts) > 1 else ""

        if p:
            self.execute("UPDATE players SET user_id = ?, first_name = ?, last_name = ?, updated_at = ? WHERE id = ?", (user_id, first_name, last_name, now, p["id"]))
            self.add_user_player(user_id, p["id"])
            return self.get_player(p["id"])
        return None

    def link_user_to_existing_player(self, user_id: str, player_id: str, google_name: str, email: str) -> Optional[Dict[str, Any]]:
        """Links user to an existing player profile and overwrites first_name and last_name with Google credentials"""
        p = self.get_player(player_id)
        if not p:
            return None
        now = time.time()
        parts = google_name.strip().split()
        first_name = parts[0] if parts else google_name
        last_name = " ".join(parts[1:]) if len(parts) > 1 else ""

        self.execute(
            """
            UPDATE players 
            SET user_id = ?, email = ?, first_name = ?, last_name = ?, updated_at = ?
            WHERE id = ?
            """,
            (user_id, email, first_name, last_name, now, player_id)
        )
        self.add_user_player(user_id, player_id)
        return self.get_player(player_id)

    def update_player_profile(self, player_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        now = time.time()
        allowed = ["nickname", "first_name", "last_name", "current_handicap"]
        set_clauses = []
        params = []
        for k in allowed:
            if k in updates and updates[k] is not None:
                set_clauses.append(f"{k} = ?")
                if k == "current_handicap":
                    params.append(round(float(updates[k]), 1))
                else:
                    params.append(str(updates[k]).strip())
        if not set_clauses:
            return self.get_player(player_id)
        set_clauses.append("updated_at = ?")
        params.append(now)
        params.append(player_id)
        self.execute(f"UPDATE players SET {', '.join(set_clauses)} WHERE id = ?", tuple(params))
        return self.get_player(player_id)

    def add_user_player(self, user_id: str, player_id: str) -> bool:
        now = time.time()
        existing = self.query_one("SELECT * FROM user_players WHERE user_id = ? AND player_id = ?", (user_id, player_id))
        if not existing:
            self.execute("INSERT INTO user_players (user_id, player_id, created_at) VALUES (?, ?, ?)", (user_id, player_id, now))
        return True

    def remove_user_player(self, user_id: str, player_id: str) -> bool:
        self.execute("DELETE FROM user_players WHERE user_id = ? AND player_id = ?", (user_id, player_id))
        return True

    def list_user_players(self, user_id: str) -> List[Dict[str, Any]]:
        """Returns the user's added players roster. If empty, auto-seeds default players into user roster."""
        rows = self.query_all(
            "SELECT p.* FROM players p JOIN user_players up ON p.id = up.player_id WHERE up.user_id = ? ORDER BY p.nickname ASC",
            (user_id,)
        )
        if not rows:
            # Auto-populate user roster with defaults
            all_p = self.list_players()[:6]
            for p in all_p:
                self.add_user_player(user_id, p["id"])
            rows = self.query_all(
                "SELECT p.* FROM players p JOIN user_players up ON p.id = up.player_id WHERE up.user_id = ? ORDER BY p.nickname ASC",
                (user_id,)
            )
        return rows

    def get_players_stats(self, user_id: Optional[str] = None, range_type: str = "all", start_date: Optional[str] = None, end_date: Optional[str] = None, target_currency: str = "THB") -> List[Dict[str, Any]]:
        """
        Calculates real-time stats (rounds played, total cash won/lost) for players in user roster.
        Supports 'all', 'this_year', or custom 'start_date' to 'end_date' filtering,
        converting historical game cash into target_currency on the fly.
        """
        now = time.time()
        target_currency = (target_currency or "THB").upper()

        # Date boundaries
        min_ts = 0.0
        max_ts = now + 86400.0

        if range_type == "this_year":
            current_year = time.localtime(now).tm_year
            start_of_year = time.mktime(time.strptime(f"{current_year}-01-01", "%Y-%m-%d"))
            min_ts = start_of_year
        elif range_type == "custom" and start_date and end_date:
            try:
                min_ts = time.mktime(time.strptime(start_date, "%Y-%m-%d"))
                max_ts = time.mktime(time.strptime(end_date, "%Y-%m-%d")) + 86399.0
            except Exception:
                pass

        # Get roster players
        if user_id:
            roster = self.list_user_players(user_id)
        else:
            roster = self.list_players()

        # Get finished rounds in date window
        rounds_rows = self.query_all(
            "SELECT id, name, created_at, game_settings, players, scores FROM rounds WHERE is_finished = 1 AND created_at >= ? AND created_at <= ?",
            (min_ts, max_ts)
        )

        from engine import calculate_tournament_state

        # Pre-calculate player totals across rounds
        player_stats_map = {
            p["id"]: {
                "id": p["id"],
                "nickname": p["nickname"],
                "first_name": p["first_name"],
                "last_name": p["last_name"],
                "email": p.get("email"),
                "handicap": p.get("current_handicap", 18.0),
                "rounds_played": 0,
                "total_cash": 0.0,
                "target_currency": target_currency
            } for p in roster
        }

        # Index roster by nicknames and emails for cross-round matching
        nick_to_id = {p["nickname"].strip().lower(): p["id"] for p in roster}
        email_to_id = {p["email"].strip().lower(): p["id"] for p in roster if p.get("email")}

        for r_row in rounds_rows:
            try:
                # Parse round fields
                r_data = dict(r_row)
                for f in ["game_settings", "players", "scores"]:
                    if isinstance(r_data.get(f), str):
                        try:
                            r_data[f] = json.loads(r_data[f])
                        except Exception:
                            r_data[f] = {}
                
                round_curr = (r_data.get("game_settings", {}).get("currency") or "THB").upper()
                calc_state = calculate_tournament_state(r_data)
                scorecards = calc_state.get("player_scorecards", [])

                for sc in scorecards:
                    sc_name = (sc.get("name") or "").strip().lower()
                    matched_ply_id = None
                    if sc.get("player_id") in player_stats_map:
                        matched_ply_id = sc.get("player_id")
                    elif sc_name in nick_to_id:
                        matched_ply_id = nick_to_id[sc_name]

                    if matched_ply_id and matched_ply_id in player_stats_map:
                        cash = float(sc.get("total_cash", 0.0))
                        conv_cash = convert_currency(cash, round_curr, target_currency)
                        player_stats_map[matched_ply_id]["rounds_played"] += 1
                        player_stats_map[matched_ply_id]["total_cash"] += conv_cash
            except Exception as e:
                print(f"[STATS ERROR] Calculating round {r_row.get('id')}: {e}")

        res = list(player_stats_map.values())
        res.sort(key=lambda x: x["total_cash"], reverse=True)
        return res

    # ================= WHS HANDICAP TRACKING =================
    def record_round_handicaps(self, round_id: str, round_data: Dict[str, Any], calculated_state: Dict[str, Any]) -> None:
        """
        After each finished game, calculate each player's handicap differential
        using the course and selected tee's slope and course rating.
        Keeps hold of 20 most recent rounds played and uses the lowest 8 to calculate the average.
        """
        now = time.time()
        round_date = time.strftime("%Y-%m-%d", time.localtime(round_data.get("created_at", now)))

        sel_tee = round_data.get("selected_tee") or DEFAULT_TEES[2]
        course_rating = float(sel_tee.get("course_rating", 71.5))
        slope_rating = float(sel_tee.get("slope_rating", 126))
        if slope_rating <= 0:
            slope_rating = 113.0

        scorecards = calculated_state.get("player_scorecards", [])
        for sc in scorecards:
            gross = sc.get("total_gross")
            played_count = sc.get("total_played", 0)
            if not gross or played_count < 18 or not isinstance(gross, (int, float)):
                continue

            differential = round((113.0 / slope_rating) * (float(gross) - course_rating), 1)

            p_name = sc.get("name")
            p_record = None
            if sc.get("player_id"):
                p_record = self.get_player(sc.get("player_id"))
            if not p_record and p_name:
                p_record = self.find_player_by_nickname_or_name(p_name)

            if p_record:
                player_db_id = p_record["id"]
                hist_id = f"diff-{round_id}-{player_db_id}"

                # Store differential in player_round_history
                if self.is_postgres:
                    self.execute(
                        """
                        INSERT INTO player_round_history 
                        (id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            gross_score = EXCLUDED.gross_score,
                            differential = EXCLUDED.differential
                        """,
                        (hist_id, player_db_id, round_id, round_date, int(gross), course_rating, slope_rating, differential, now)
                    )
                else:
                    self.execute(
                        """
                        INSERT OR REPLACE INTO player_round_history 
                        (id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (hist_id, player_db_id, round_id, round_date, int(gross), course_rating, slope_rating, differential, now)
                    )

                # Query last 20 score differentials
                history_rows = self.query_all(
                    "SELECT differential FROM player_round_history WHERE player_id = ? ORDER BY round_date DESC, created_at DESC LIMIT 20",
                    (player_db_id,)
                )
                diffs = [float(r["differential"]) for r in history_rows]
                diffs.sort()
                count = len(diffs)
                if count >= 20:
                    lowest = diffs[:8]
                elif count >= 15:
                    lowest = diffs[:6]
                elif count >= 12:
                    lowest = diffs[:4]
                elif count >= 9:
                    lowest = diffs[:3]
                elif count >= 6:
                    lowest = diffs[:2]
                elif count >= 3:
                    lowest = diffs[:1]
                else:
                    lowest = diffs[:1]

                if lowest:
                    new_hcp = round(sum(lowest) / len(lowest), 1)
                    self.execute(
                        "UPDATE players SET current_handicap = ?, updated_at = ? WHERE id = ?",
                        (new_hcp, now, player_db_id)
                    )
                    print(f"[WHS HCP] Updated {p_record['nickname']} handicap to {new_hcp} (lowest {len(lowest)} of {count} rounds).")


# Global database singleton
db = Database()
