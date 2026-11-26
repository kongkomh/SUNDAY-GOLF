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
            gross_score INTEGER,
            course_rating REAL,
            slope_rating REAL,
            differential REAL,
            created_at REAL
        );
        """

        for q in [users_table, courses_table, rounds_table, players_table, user_players_table, history_table]:
            self.execute(q)

        # Migration column safety for existing databases
        for alter_q in [
            "ALTER TABLE courses ADD COLUMN tees TEXT;",
            "ALTER TABLE rounds ADD COLUMN selected_tee TEXT;",
            "ALTER TABLE rounds ADD COLUMN is_manual INTEGER DEFAULT 0;",
            "ALTER TABLE player_round_history ADD COLUMN course_name VARCHAR(255);",
            "ALTER TABLE player_round_history ADD COLUMN cash_won REAL DEFAULT 0.0;",
            "ALTER TABLE player_round_history ADD COLUMN currency VARCHAR(10) DEFAULT 'THB';"
        ]:
            try:
                self.execute(alter_q)
            except Exception:
                pass

        # Ensure player_round_history columns are nullable for blank gross scores
        if self.is_postgres:
            for col in ["gross_score", "course_rating", "slope_rating", "differential"]:
                try:
                    self.execute(f"ALTER TABLE player_round_history ALTER COLUMN {col} DROP NOT NULL;")
                except Exception:
                    pass
        else:
            try:
                t_info = self.query_all("PRAGMA table_info(player_round_history);")
                if any(c.get("name") == "gross_score" and c.get("notnull") == 1 for c in t_info):
                    self.execute("""
                    CREATE TABLE player_round_history_temp (
                        id VARCHAR(255) PRIMARY KEY,
                        player_id VARCHAR(255) NOT NULL,
                        round_id VARCHAR(255) NOT NULL,
                        round_date VARCHAR(64) NOT NULL,
                        gross_score INTEGER,
                        course_rating REAL,
                        slope_rating REAL,
                        differential REAL,
                        created_at REAL,
                        course_name VARCHAR(255),
                        cash_won REAL DEFAULT 0.0,
                        currency VARCHAR(10) DEFAULT 'THB'
                    );
                    """)
                    self.execute("INSERT INTO player_round_history_temp SELECT id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, created_at, course_name, cash_won, currency FROM player_round_history;")
                    self.execute("DROP TABLE player_round_history;")
                    self.execute("ALTER TABLE player_round_history_temp RENAME TO player_round_history;")
            except Exception as e:
                print(f"[DB MIG ERROR] {e}")

        # Clean up any dummy seed players ('PLAYER 1' .. 'PLAYER 6')
        try:
            self.execute("DELETE FROM user_players WHERE player_id IN ('ply-p1', 'ply-p2', 'ply-p3', 'ply-p4', 'ply-p5', 'ply-p6');")
            self.execute("DELETE FROM players WHERE id IN ('ply-p1', 'ply-p2', 'ply-p3', 'ply-p4', 'ply-p5', 'ply-p6') OR nickname LIKE 'PLAYER %';")
        except Exception:
            pass

        # Deduplicate players sharing identical full names (first_name + last_name)
        try:
            name_dups = self.query_all(
                "SELECT LOWER(first_name) as fn, LOWER(last_name) as ln, COUNT(*) as cnt FROM players WHERE first_name != '' AND last_name != '' GROUP BY LOWER(first_name), LOWER(last_name) HAVING cnt > 1;"
            )
            for nd in name_dups:
                matches = self.query_all(
                    "SELECT * FROM players WHERE LOWER(first_name) = ? AND LOWER(last_name) = ? ORDER BY created_at ASC;",
                    (nd["fn"], nd["ln"])
                )
                if len(matches) > 1:
                    scored = []
                    for m in matches:
                        hist_cnt = self.query_one("SELECT COUNT(*) as cnt FROM player_round_history WHERE player_id = ?;", (m["id"],))
                        h_count = hist_cnt.get("cnt", 0) if hist_cnt else 0
                        score = (20 if h_count > 0 else 0) + (10 if m.get("user_id") else 0) + (5 if m.get("email") else 0)
                        scored.append((score, h_count, m))
                    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
                    best_match = scored[0][2]
                    duplicates = [s[2] for s in scored[1:]]

                    chosen_user_id = best_match.get("user_id") or next((d.get("user_id") for d in duplicates if d.get("user_id")), None)
                    chosen_email = best_match.get("email") or next((d.get("email") for d in duplicates if d.get("email")), None)
                    if chosen_user_id != best_match.get("user_id") or chosen_email != best_match.get("email"):
                        self.execute("UPDATE players SET user_id = ?, email = ? WHERE id = ?;", (chosen_user_id, chosen_email, best_match["id"]))

                    for dup in duplicates:
                        try:
                            self.execute("UPDATE user_players SET player_id = ? WHERE player_id = ?;", (best_match["id"], dup["id"]))
                        except Exception:
                            self.execute("DELETE FROM user_players WHERE player_id = ?;", (dup["id"],))
                        try:
                            self.execute("UPDATE player_round_history SET player_id = ? WHERE player_id = ?;", (best_match["id"], dup["id"]))
                        except Exception:
                            pass
                        self.execute("DELETE FROM players WHERE id = ?;", (dup["id"],))
                        print(f"[DEDUP] Merged duplicate player '{dup['nickname']}' ({dup['id']}) into '{best_match['nickname']}' ({best_match['id']})")
        except Exception as e:
            print(f"[DEDUP ERROR] {e}")

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
        # Clean course holes so SQL courses table never records is_turbo
        clean_course_holes = [{
            "hole": int(h.get("hole", i + 1)),
            "par": int(h.get("par", 4)),
            "handicap": int(h.get("handicap", 9))
        } for i, h in enumerate(holes)]
        holes_json = json.dumps(clean_course_holes)
        tees_json = json.dumps(tees or DEFAULT_TEES)

        self.execute(
            "INSERT INTO courses (id, name, location, holes, tees, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (course_id, course_name, location, holes_json, tees_json, now)
        )
        return {
            "id": course_id,
            "name": course_name,
            "location": location,
            "holes": clean_course_holes,
            "tees": tees or DEFAULT_TEES,
            "created_at": now
        }

    def update_course(self, course_id: str, course_name: str, holes: List[Dict[str, Any]], tees: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        now = time.time()
        existing = self.get_course(course_id)
        if not existing:
            # Course does not exist in courses table yet; create/insert it
            new_c = self.create_course(course_name, holes, location="Thailand", tees=tees or DEFAULT_TEES)
            return new_c

        # Clean course holes so SQL courses table never records is_turbo
        clean_course_holes = [{
            "hole": int(h.get("hole", i + 1)),
            "par": int(h.get("par", 4)),
            "handicap": int(h.get("handicap", 9))
        } for i, h in enumerate(holes)]

        if tees is not None:
            self.execute(
                "UPDATE courses SET name = ?, holes = ?, tees = ? WHERE id = ?",
                (course_name, json.dumps(clean_course_holes), json.dumps(tees), course_id)
            )
        else:
            self.execute(
                "UPDATE courses SET name = ?, holes = ? WHERE id = ?",
                (course_name, json.dumps(clean_course_holes), course_id)
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

    def _parse_round_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        parsed = dict(row)
        for field in ["game_settings", "players", "holes", "scores"]:
            if isinstance(parsed.get(field), str):
                try:
                    parsed[field] = json.loads(parsed[field])
                except Exception:
                    parsed[field] = {} if field in ["game_settings", "scores"] else []
            elif parsed.get(field) is None:
                parsed[field] = {} if field in ["game_settings", "scores"] else []
        if isinstance(parsed.get("selected_tee"), str):
            try:
                parsed["selected_tee"] = json.loads(parsed["selected_tee"])
            except Exception:
                parsed["selected_tee"] = DEFAULT_TEES[2]
        if not parsed.get("selected_tee"):
            parsed["selected_tee"] = DEFAULT_TEES[2]

        parsed["is_finished"] = bool(parsed.get("is_finished", 0))
        parsed["is_manual"] = bool(parsed.get("is_manual", 0))
        return parsed

    def get_round(self, round_id: str) -> Optional[Dict[str, Any]]:
        row = self.query_one("SELECT * FROM rounds WHERE id = ?", (round_id,))
        if not row:
            return None
        return self._parse_round_row(row)

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
                r["is_manual"] = bool(r.get("is_manual", 0))
                r["is_owner"] = is_owner
                date_val = r.get("created_at") or time.time()
                r["date_str"] = time.strftime("%Y-%m-%d", time.localtime(date_val)) if isinstance(date_val, (int, float)) else str(date_val)[:10]
                creator_name = "Guest"
                if r.get("owner_id"):
                    u = self.get_user(r["owner_id"])
                    if u:
                        parts = (u.get("name") or "Golfer").split()
                        creator_name = parts[0] if parts else "Golfer"
                r["creator_name"] = creator_name
                course_title = r.get("course_name") or "Golf Course"
                r["round_name"] = f"{r['date_str']} {course_title} - {creator_name}"
                r["player_names"] = [p.get("name") for p in (r.get("players") or []) if p.get("name")]
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
        # Find affected players from both round lineup and history to recalculate handicaps
        affected_pids = set()
        existing_rnd = self.get_round(round_id)
        if existing_rnd:
            for p_slot in (existing_rnd.get("players") or []):
                if isinstance(p_slot, dict):
                    if p_slot.get("player_id"):
                        affected_pids.add(p_slot["player_id"])
                    elif p_slot.get("name"):
                        matched_p = self.find_player_by_nickname_or_name(p_slot["name"])
                        if matched_p:
                            affected_pids.add(matched_p["id"])
        history_rows = self.query_all("SELECT DISTINCT player_id FROM player_round_history WHERE round_id = ?", (round_id,))
        for r in history_rows:
            if r.get("player_id"):
                affected_pids.add(r["player_id"])

        self.execute("DELETE FROM player_round_history WHERE round_id = ?", (round_id,))
        self.execute("DELETE FROM rounds WHERE id = ?", (round_id,))
        for pid in affected_pids:
            self.recalculate_player_handicap(pid)
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

        if not p and first_name and last_name:
            # Fallback 1: match by first_name and last_name
            p = self.query_one(
                "SELECT * FROM players WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)",
                (first_name.strip(), last_name.strip())
            )
        if not p and parts:
            # Fallback 2: match by nickname
            p = self.query_one(
                "SELECT * FROM players WHERE LOWER(nickname) = LOWER(?)",
                (parts[0].strip(),)
            )

        if p:
            self.execute("UPDATE players SET user_id = ?, email = ?, first_name = ?, last_name = ?, updated_at = ? WHERE id = ?", (user_id, email, first_name, last_name, now, p["id"]))
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

    def _round_might_include_player(self, player: Dict[str, Any], raw_players: Any) -> bool:
        if not isinstance(raw_players, list):
            return False
        pid = player["id"]
        nick_low = (player.get("nickname") or "").strip().lower()
        full_low = f"{player.get('first_name') or ''} {player.get('last_name') or ''}".strip().lower()
        for p in raw_players:
            if not isinstance(p, dict):
                continue
            p_pid = p.get("player_id")
            if p_pid == pid:
                return True
            if not p_pid:
                p_name = (p.get("name") or p.get("nickname") or "").strip().lower()
                if p_name and (p_name == nick_low or (full_low and p_name == full_low)):
                    return True
        return False

    def _match_player_in_leaderboard(self, player: Dict[str, Any], round_data: Dict[str, Any], calc_state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        pid = player["id"]
        nick_low = (player.get("nickname") or "").strip().lower()
        full_low = f"{player.get('first_name') or ''} {player.get('last_name') or ''}".strip().lower()
        slot_to_pid = {
            p.get("id"): p.get("player_id")
            for p in (round_data.get("players") or [])
            if isinstance(p, dict)
        }
        leaderboard = calc_state.get("leaderboard") or calc_state.get("player_scorecards") or []

        # 1. Primary match: explicit player_id on leaderboard or round player slot
        for lb in leaderboard:
            lb_pid = lb.get("player_id") or slot_to_pid.get(lb.get("id"))
            if lb_pid == pid:
                return lb

        # 2. Fallback match for older rounds where player_id was not stored on the slot
        for lb in leaderboard:
            lb_pid = lb.get("player_id") or slot_to_pid.get(lb.get("id"))
            if lb_pid:
                continue
            lb_name = (lb.get("name") or "").strip().lower()
            if lb_name and (lb_name == nick_low or (full_low and lb_name == full_low)):
                return lb

        return None

    def get_players_stats(self, user_id: Optional[str] = None, range_type: str = "all", start_date: Optional[str] = None, end_date: Optional[str] = None, target_currency: str = "THB") -> List[Dict[str, Any]]:
        """
        Calculates real-time stats (rounds played, total cash won/lost) for players in user roster
        by querying all finished SQL rounds and summing each player's Leaderboard CASH (WON/LOST),
        converted into target_currency.
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

        # Query full finished rounds in date window so Leaderboard calculation has holes, starting_hole, is_manual, etc.
        rounds_rows = self.query_all(
            "SELECT * FROM rounds WHERE is_finished = 1 AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC",
            (min_ts, max_ts)
        )

        from engine import calculate_tournament_state

        player_stats_map = {
            p["id"]: {
                "id": p["id"],
                "nickname": p["nickname"],
                "first_name": p["first_name"],
                "last_name": p["last_name"],
                "email": p.get("email"),
                "current_handicap": p.get("current_handicap", 18.0),
                "handicap": p.get("current_handicap", 18.0),
                "rounds_played": 0,
                "total_cash": 0.0,
                "total_cash_won_lost": 0.0,
                "target_currency": target_currency
            } for p in roster
        }

        for r_row in rounds_rows:
            try:
                r_data = self._parse_round_row(r_row)
                raw_players = r_data.get("players") or []
                if not any(self._round_might_include_player(p, raw_players) for p in roster):
                    continue

                round_curr = ((r_data.get("game_settings") or {}).get("currency") or "THB").upper()
                calc_state = calculate_tournament_state(r_data)

                for p in roster:
                    lb_entry = self._match_player_in_leaderboard(p, r_data, calc_state)
                    if lb_entry is not None:
                        cash = round(float(lb_entry.get("total_cash", 0.0)), 2)
                        conv_cash = convert_currency(cash, round_curr, target_currency)
                        st = player_stats_map[p["id"]]
                        st["rounds_played"] += 1
                        st["total_cash"] += conv_cash
                        st["total_cash_won_lost"] += conv_cash
            except Exception as e:
                print(f"[STATS ERROR] Calculating round {r_row.get('id')}: {e}")

        res = list(player_stats_map.values())
        for st in res:
            st["total_cash"] = round(st["total_cash"], 2)
            st["total_cash_won_lost"] = st["total_cash"]
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

        leaderboard = calculated_state.get("leaderboard") or calculated_state.get("player_scorecards") or []
        for sc in leaderboard:
            p_name = sc.get("name")
            p_record = None
            if sc.get("player_id"):
                p_record = self.get_player(sc.get("player_id"))
            if not p_record and p_name:
                p_record = self.find_player_by_nickname_or_name(p_name)
            if not p_record:
                continue

            player_db_id = p_record["id"]
            gross = sc.get("total_gross")
            played_count = sc.get("total_played", 0)
            has_18_gross = bool(gross and played_count >= 18 and isinstance(gross, (int, float)))
            gross_val = int(gross) if (gross is not None and played_count > 0) else None
            differential = round((113.0 / slope_rating) * (float(gross) - course_rating), 1) if has_18_gross else None

            hist_id = f"diff-{round_id}-{player_db_id}"
            c_title = round_data.get("course_name") or "Golf Course"
            cash_val = round(float(sc.get("total_cash") or 0.0), 2)
            curr_str = (round_data.get("game_settings") or {}).get("currency", "THB")

            if self.is_postgres:
                self.execute(
                    """
                    INSERT INTO player_round_history 
                    (id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, course_name, cash_won, currency, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        gross_score = EXCLUDED.gross_score,
                        differential = EXCLUDED.differential,
                        course_name = EXCLUDED.course_name,
                        cash_won = EXCLUDED.cash_won,
                        currency = EXCLUDED.currency
                    """,
                    (hist_id, player_db_id, round_id, round_date, gross_val, course_rating, slope_rating, differential, c_title, cash_val, curr_str, now)
                )
            else:
                self.execute(
                    """
                    INSERT OR REPLACE INTO player_round_history 
                    (id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, course_name, cash_won, currency, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (hist_id, player_db_id, round_id, round_date, gross_val, course_rating, slope_rating, differential, c_title, cash_val, curr_str, now)
                )

            self.recalculate_player_handicap(player_db_id)

    def recalculate_player_handicap(self, player_id: str) -> Optional[float]:
        """
        Recalculates player's WHS Handicap Index from their last 20 finished rounds with valid differentials.
        """
        history_items = self.get_player_rounds_history(player_id)
        diffs = [float(r["differential"]) for r in history_items if r.get("differential") is not None][:20]
        diffs.sort()
        count = len(diffs)
        new_hcp = calculate_whs_handicap(diffs)
        now = time.time()
        if new_hcp is not None:
            self.execute(
                "UPDATE players SET current_handicap = ?, updated_at = ? WHERE id = ?",
                (new_hcp, now, player_id)
            )
            print(f"[WHS HCP] Updated player {player_id} handicap to {new_hcp} (USGA Rule 5.2a using {count} rounds).")
            return new_hcp
        return None

    def get_player_rounds_history(self, player_id: str) -> List[Dict[str, Any]]:
        """
        Retrieves all finished rounds for a player directly from SQL `rounds`,
        computing each round's Leaderboard CASH (WON/LOST) in its native currency,
        along with gross score, WHS differential, and USGA Rule 5.2a counting flag (is_counting).
        """
        player = self.get_player(player_id)
        if not player:
            return []

        from engine import calculate_tournament_state

        rows = self.query_all("SELECT * FROM rounds WHERE is_finished = 1 ORDER BY created_at DESC")
        now = time.time()
        items = []

        for r_row in rows:
            try:
                r_data = self._parse_round_row(r_row)
                if not self._round_might_include_player(player, r_data.get("players") or []):
                    continue

                calc_state = calculate_tournament_state(r_data)
                lb_entry = self._match_player_in_leaderboard(player, r_data, calc_state)
                if lb_entry is None:
                    continue

                created_ts = r_data.get("created_at") or now
                round_date = (
                    time.strftime("%Y-%m-%d", time.localtime(created_ts))
                    if isinstance(created_ts, (int, float))
                    else str(created_ts)[:10]
                )
                c_name = r_data.get("course_name") or "Golf Course"
                curr = (r_data.get("game_settings") or {}).get("currency") or "THB"
                cash_won = round(float(lb_entry.get("total_cash", 0.0)), 2)

                total_played = int(lb_entry.get("total_played") or 0)
                raw_gross = lb_entry.get("total_gross")
                gross_score = int(raw_gross) if (raw_gross is not None and total_played > 0) else None

                sel_tee = r_data.get("selected_tee") or DEFAULT_TEES[2]
                course_rating = float(sel_tee.get("course_rating", 71.5))
                slope_rating = float(sel_tee.get("slope_rating", 126))
                if slope_rating <= 0:
                    slope_rating = 113.0

                differential = (
                    round((113.0 / slope_rating) * (float(gross_score) - course_rating), 1)
                    if (gross_score is not None and total_played >= 18)
                    else None
                )

                items.append({
                    "id": f"rnd-{r_data['id']}-{player_id}",
                    "round_id": r_data["id"],
                    "round_date": round_date,
                    "course_name": c_name,
                    "gross_score": gross_score,
                    "differential": differential,
                    "cash_won": cash_won,
                    "currency": curr,
                    "is_manual": bool(r_data.get("is_manual", False))
                })
            except Exception as e:
                print(f"[HISTORY ERROR] Calculating round {r_row.get('id')} for player {player_id}: {e}")

        # Determine which differentials count towards handicap per USGA Rule 5.2a (among 20 most recent valid differentials)
        valid_indices_and_items = [(i, itm) for i, itm in enumerate(items) if itm.get("differential") is not None][:20]
        n = len(valid_indices_and_items)
        if n < 3:
            k = 0
        elif 3 <= n <= 5:
            k = 1
        elif 6 <= n <= 8:
            k = 2
        elif 9 <= n <= 11:
            k = 3
        elif 12 <= n <= 14:
            k = 4
        elif 15 <= n <= 16:
            k = 5
        elif 17 <= n <= 18:
            k = 6
        elif n == 19:
            k = 7
        else:
            k = 8

        # Lowest k differentials count
        valid_sorted = sorted(valid_indices_and_items, key=lambda x: x[1]["differential"])
        counting_indices = set(idx for idx, _ in valid_sorted[:k])
        for i, itm in enumerate(items):
            itm["is_counting"] = (i in counting_indices)

        return items

    # ================= ADMIN OPERATIONS =================
    def admin_get_accounts(self) -> Dict[str, Any]:
        """Returns all Google user accounts and player profiles with link mapping."""
        users_rows = self.query_all("SELECT id, email, name, picture, created_at FROM users ORDER BY created_at DESC")
        players_rows = self.query_all("SELECT id, nickname, first_name, last_name, email, user_id, current_handicap, created_at FROM players ORDER BY nickname ASC")

        user_map = {u["id"]: u for u in users_rows}
        player_by_user_id = {p["user_id"]: p for p in players_rows if p.get("user_id")}

        formatted_users = []
        for u in users_rows:
            u_dict = dict(u)
            lp = player_by_user_id.get(u["id"])
            u_dict["linked_player"] = {
                "id": lp["id"],
                "nickname": lp["nickname"],
                "first_name": lp["first_name"],
                "last_name": lp["last_name"],
                "current_handicap": lp["current_handicap"]
            } if lp else None
            formatted_users.append(u_dict)

        formatted_players = []
        for p in players_rows:
            p_dict = dict(p)
            lu = user_map.get(p.get("user_id")) if p.get("user_id") else None
            p_dict["linked_user"] = {
                "id": lu["id"],
                "email": lu["email"],
                "name": lu["name"]
            } if lu else None
            formatted_players.append(p_dict)

        return {
            "users": formatted_users,
            "players": formatted_players
        }

    def admin_link_user_to_player(self, user_id: str, player_id: str) -> Optional[Dict[str, Any]]:
        """Links a Google user account to a player profile, updating email and user roster."""
        u = self.get_user(user_id)
        p = self.get_player(player_id)
        if not u or not p:
            return None
        now = time.time()
        # Unlink any other player previously attached to this user
        self.execute("UPDATE players SET user_id = NULL WHERE user_id = ? AND id != ?", (user_id, player_id))
        self.execute("UPDATE players SET user_id = ?, email = ?, updated_at = ? WHERE id = ?", (user_id, u["email"], now, player_id))
        self.add_user_player(user_id, player_id)
        return self.get_player(player_id)

    def admin_unlink_player(self, player_id: str) -> bool:
        """Unlinks a player profile from any Google user account."""
        p = self.get_player(player_id)
        if not p:
            return False
        user_id = p.get("user_id")
        self.execute("UPDATE players SET user_id = NULL, updated_at = ? WHERE id = ?", (time.time(), player_id))
        if user_id:
            self.execute("DELETE FROM user_players WHERE user_id = ? AND player_id = ?", (user_id, player_id))
        return True

    def admin_delete_player(self, player_id: str) -> bool:
        """Permanently deletes a player profile from players, user_players, and history."""
        self.execute("DELETE FROM user_players WHERE player_id = ?", (player_id,))
        self.execute("DELETE FROM player_round_history WHERE player_id = ?", (player_id,))
        self.execute("DELETE FROM players WHERE id = ?", (player_id,))
        return True

    def admin_get_all_rounds(self) -> List[Dict[str, Any]]:
        """Returns all rounds across all users for admin management."""
        rows = self.query_all("SELECT * FROM rounds ORDER BY created_at DESC")
        all_users = {u["id"]: u for u in self.query_all("SELECT id, name, email FROM users")}
        res = []
        for r in rows:
            r_dict = dict(r)
            for field in ["game_settings", "players", "holes", "scores"]:
                if isinstance(r_dict.get(field), str):
                    try:
                        r_dict[field] = json.loads(r_dict[field])
                    except Exception:
                        r_dict[field] = {} if field in ["game_settings", "scores"] else []
            r_dict["is_finished"] = bool(r_dict.get("is_finished", 0))
            r_dict["is_manual"] = bool(r_dict.get("is_manual", 0))
            date_val = r_dict.get("created_at") or time.time()
            r_dict["date_str"] = time.strftime("%Y-%m-%d", time.localtime(date_val)) if isinstance(date_val, (int, float)) else str(date_val)[:10]

            creator_name = "Unknown"
            creator_email = "-"
            if r_dict.get("owner_id"):
                u = all_users.get(r_dict["owner_id"])
                if u:
                    creator_name = u.get("name") or "Golfer"
                    creator_email = u.get("email") or "-"
            r_dict["creator_name"] = creator_name
            r_dict["creator_email"] = creator_email
            p_list = r_dict.get("players") or []
            r_dict["players_count"] = len(p_list)
            r_dict["player_names"] = [p.get("name") for p in p_list if p.get("name")]
            res.append(r_dict)
        return res

    def admin_create_manual_round(self, admin_user_id: str, course_id: str, tee_name: str, date_str: str, currency: str, players_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Creates a manual-round in the database, inserting round records and player history.
        Gross scores calculate differentials and WHS handicap index; blank scores are excluded from handicap.
        """
        c = self.get_course(course_id)
        if not c:
            all_courses = self.list_courses()
            c = all_courses[0] if all_courses else {"id": course_id, "name": "Golf Course", "holes": [], "tees": DEFAULT_TEES}

        # Match tee
        tees = c.get("tees") or DEFAULT_TEES
        tee_obj = next((t for t in tees if str(t.get("name", "")).strip().lower() == str(tee_name).strip().lower()), None)
        if not tee_obj:
            tee_obj = tees[2] if len(tees) > 2 else tees[0]

        course_rating = float(tee_obj.get("course_rating", 71.5))
        slope_rating = float(tee_obj.get("slope_rating", 126))
        slope = slope_rating if slope_rating > 0 else 113.0
        course_name = c.get("name") or "Golf Course"

        now = time.time()
        try:
            created_ts = time.mktime(time.strptime(date_str, "%Y-%m-%d")) + 43200.0
        except Exception:
            created_ts = now

        round_id = f"manual-round-{int(created_ts)}-{os.urandom(3).hex()}"
        admin_user = self.get_user(admin_user_id)
        creator_name = (admin_user.get("name") or "Admin").split()[0] if admin_user else "Admin"
        round_name = f"{date_str} {course_name} - {creator_name} (Manual)"

        from engine import DEFAULT_PLAYER_COLORS
        lineup = []
        players_with_gross = []

        for idx, p_input in enumerate(players_data):
            p_db_id = p_input.get("player_id")
            p_rec = self.get_player(p_db_id)
            if not p_rec:
                continue

            raw_gross = p_input.get("gross_score")
            has_gross = raw_gross is not None and str(raw_gross).strip() != ""
            gross_score = int(raw_gross) if has_gross else None
            cash_won_lost = float(p_input.get("cash_won_lost") or 0.0)

            diff_val = round((113.0 / slope) * (float(gross_score) - course_rating), 1) if has_gross else None
            hist_id = f"diff-{round_id}-{p_db_id}"

            if self.is_postgres:
                self.execute(
                    """
                    INSERT INTO player_round_history 
                    (id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, course_name, cash_won, currency, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        gross_score = EXCLUDED.gross_score,
                        differential = EXCLUDED.differential,
                        course_name = EXCLUDED.course_name,
                        cash_won = EXCLUDED.cash_won,
                        currency = EXCLUDED.currency
                    """,
                    (hist_id, p_db_id, round_id, date_str, gross_score, course_rating, slope_rating, diff_val, course_name, cash_won_lost, currency, now)
                )
            else:
                self.execute(
                    """
                    INSERT OR REPLACE INTO player_round_history 
                    (id, player_id, round_id, round_date, gross_score, course_rating, slope_rating, differential, course_name, cash_won, currency, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (hist_id, p_db_id, round_id, date_str, gross_score, course_rating, slope_rating, diff_val, course_name, cash_won_lost, currency, now)
                )

            if has_gross:
                players_with_gross.append(p_db_id)

            self.add_user_player(admin_user_id, p_db_id)

            lineup.append({
                "id": f"p{idx+1}",
                "player_id": p_db_id,
                "name": p_rec["nickname"],
                "color": DEFAULT_PLAYER_COLORS[idx % len(DEFAULT_PLAYER_COLORS)],
                "gross_score": gross_score,
                "cash_won_lost": cash_won_lost,
                "default_team": "left" if idx < len(players_data) // 2 else "right"
            })

        game_settings = {
            "currency": currency,
            "is_manual": True,
            "game_mode": "FREE_FOR_ALL"
        }

        self.execute(
            """
            INSERT INTO rounds 
            (id, owner_id, name, course_id, course_name, starting_hole, is_finished, is_manual, selected_tee, game_settings, players, holes, scores, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (round_id, admin_user_id, round_name, c.get("id"), course_name, 1, 1, 1, json.dumps(tee_obj), json.dumps(game_settings), json.dumps(lineup), json.dumps(c.get("holes") or []), json.dumps({}), created_ts, created_ts)
        )

        for p_db_id in players_with_gross:
            self.recalculate_player_handicap(p_db_id)

        return self.get_round(round_id)  # type: ignore


def calculate_whs_handicap(diffs: List[float]) -> Optional[float]:
    """
    USGA Rule 5.2a: Handicap Index calculation based on number of differentials available (up to 20).
    diffs must be sorted ascending (lowest first).
    Returns None if fewer than 3 differentials (minimum requirement is 3 rounds).
    """
    count = len(diffs)
    if count < 3:
        return None

    if count == 3:
        used = diffs[:1]
        adj = -2.0
    elif count == 4:
        used = diffs[:1]
        adj = -1.0
    elif count == 5:
        used = diffs[:1]
        adj = 0.0
    elif count == 6:
        used = diffs[:2]
        adj = -1.0
    elif count in (7, 8):
        used = diffs[:2]
        adj = 0.0
    elif 9 <= count <= 11:
        used = diffs[:3]
        adj = 0.0
    elif 12 <= count <= 14:
        used = diffs[:4]
        adj = 0.0
    elif count in (15, 16):
        used = diffs[:5]
        adj = 0.0
    elif count in (17, 18):
        used = diffs[:6]
        adj = 0.0
    elif count == 19:
        used = diffs[:7]
        adj = 0.0
    else:  # count >= 20
        used = diffs[:8]
        adj = 0.0

    avg_lowest = sum(used) / len(used)
    return round(avg_lowest + adj, 1)


# Global database singleton
db = Database()
