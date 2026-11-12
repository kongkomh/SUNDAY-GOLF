"""
Sunday Golf Tracker - Database Layer
Supports PostgreSQL (via Railway DATABASE_URL) and SQLite (local fallback)
"""

import os
import json
import time
import sqlite3
import re
from typing import Dict, List, Any, Optional

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
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


class Database:
    def __init__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        self.is_postgres = IS_POSTGRES
        self.init_schema()
        self.seed_courses_if_empty()

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
                # Replace '?' with '%s' for Postgres
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
        """Initializes tables for Users, Courses, and Rounds"""
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
            game_settings TEXT,
            players TEXT,
            holes TEXT,
            scores TEXT,
            created_at REAL,
            updated_at REAL
        );
        """

        for q in [users_table, courses_table, rounds_table]:
            self.execute(q)

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
                    self.execute(
                        "INSERT INTO courses (id, name, location, holes, created_at) VALUES (?, ?, ?, ?, ?)",
                        (c_id, c_name, c_loc, c_holes, now)
                    )
                print(f"[DB SEED] Seeded {len(courses)} courses from courses.json into SQL database.")
            except Exception as e:
                print(f"[DB SEED ERROR] Failed to seed courses: {e}")

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
        return self.get_user(user_id) or {"id": user_id, "email": email, "name": name, "picture": picture}

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
        return rows

    def get_course(self, course_id: str) -> Optional[Dict[str, Any]]:
        row = self.query_one("SELECT * FROM courses WHERE id = ?", (course_id,))
        if row and isinstance(row.get("holes"), str):
            try:
                row["holes"] = json.loads(row["holes"])
            except Exception:
                row["holes"] = []
        return row

    def create_course(self, course_name: str, holes: List[Dict[str, Any]], location: str = "Custom") -> Dict[str, Any]:
        slug = re.sub(r'[^a-zA-Z0-9]+', '-', course_name.lower()).strip('-')
        if not slug:
            slug = "custom-course"
        course_id = f"course-{slug}-{int(time.time())}"
        now = time.time()
        holes_json = json.dumps(holes)

        self.execute(
            "INSERT INTO courses (id, name, location, holes, created_at) VALUES (?, ?, ?, ?, ?)",
            (course_id, course_name, location, holes_json, now)
        )
        return {
            "id": course_id,
            "name": course_name,
            "location": location,
            "holes": holes,
            "created_at": now
        }

    def update_course(self, course_id: str, course_name: str, holes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        self.execute(
            "UPDATE courses SET name = ?, holes = ? WHERE id = ?",
            (course_name, json.dumps(holes), course_id)
        )
        return self.get_course(course_id)

    # ================= ROUNDS CRUD =================
    def create_round(self, round_data: Dict[str, Any], owner_id: Optional[str] = None) -> Dict[str, Any]:
        now = time.time()
        r_id = round_data.get("id") or f"r-{int(now)}-{os.urandom(3).hex()}"
        
        c_name = round_data.get("course_name") or "Krungthep Kreetha Golf Course"
        date_str = time.strftime("%Y-%m-%d", time.localtime(now))
        default_name = f"{date_str} - {c_name}"
        name = round_data.get("name") or default_name

        course_id = round_data.get("course_id") or "course-krungthep-kreetha"
        starting_hole = int(round_data.get("starting_hole") or 1)
        is_finished = 1 if round_data.get("is_finished") else 0

        game_settings = json.dumps(round_data.get("game_settings") or {})
        players = json.dumps(round_data.get("players") or [])
        holes = json.dumps(round_data.get("holes") or [])
        scores = json.dumps(round_data.get("scores") or {})

        self.execute(
            """
            INSERT INTO rounds 
            (id, owner_id, name, course_id, course_name, starting_hole, is_finished, game_settings, players, holes, scores, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (r_id, owner_id, name, course_id, c_name, starting_hole, is_finished, game_settings, players, holes, scores, now, now)
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
        row["is_finished"] = bool(row.get("is_finished", 0))
        return row

    def list_user_rounds(self, user_id: str) -> List[Dict[str, Any]]:
        rows = self.query_all("SELECT * FROM rounds WHERE owner_id = ? ORDER BY updated_at DESC", (user_id,))
        for r in rows:
            for field in ["game_settings", "players", "holes", "scores"]:
                if isinstance(r.get(field), str):
                    try:
                        r[field] = json.loads(r[field])
                    except Exception:
                        r[field] = {} if field in ["game_settings", "scores"] else []
            r["is_finished"] = bool(r.get("is_finished", 0))
        return rows

    def get_latest_round(self) -> Optional[Dict[str, Any]]:
        row = self.query_one("SELECT * FROM rounds ORDER BY updated_at DESC LIMIT 1")
        if not row:
            return None
        for field in ["game_settings", "players", "holes", "scores"]:
            if isinstance(row.get(field), str):
                try:
                    row[field] = json.loads(row[field])
                except Exception:
                    row[field] = {} if field in ["game_settings", "scores"] else []
        row["is_finished"] = bool(row.get("is_finished", 0))
        return row

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
                game_settings = ?,
                players = ?,
                holes = ?,
                scores = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (name, course_id, course_name, starting_hole, is_finished, game_settings, players, holes, scores, now, round_id)
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


# Global database singleton
db = Database()
