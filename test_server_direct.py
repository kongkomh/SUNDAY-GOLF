"""
Direct in-memory store tests for Sunday Golf Tracker (1 group, 3-6 players, Normal & Wolf)
"""

import os
import sys
import unittest
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from server import TournamentStore, INITIAL_DATA
from engine import calculate_tournament_state

class TestSundayServerDirect(unittest.TestCase):

    def setUp(self):
        self.test_data_path = os.path.join(os.path.dirname(__file__), "data", "test_store.json")
        if os.path.exists(self.test_data_path):
            os.remove(self.test_data_path)
        self.store = TournamentStore(self.test_data_path)

    def tearDown(self):
        if os.path.exists(self.test_data_path):
            os.remove(self.test_data_path)

    def test_store_initialization(self):
        state = self.store.get_state()
        self.assertEqual(state["tournament_name"], "Sunday Golf Match")
        self.assertEqual(len(state["players"]), 4)
        self.assertEqual(len(state["holes"]), 18)
        self.assertIn("leaderboard", state)
        self.assertIn("game_settings", state)
        self.assertTrue(state["game_settings"]["turbo"])
        self.assertFalse(state["game_settings"]["turbo_handicap"])
        self.assertTrue(state["game_settings"]["penetrate"])

    def test_score_updating(self):
        # Update Hole 1 score for 2v2 (p1, p2 vs p3, p4) - sweep with penetrate bonus
        res = self.store.set_hole_scores(
            hole_num=1,
            score_data={"p1": 4, "p2": 4, "p3": 5, "p4": 5},
            team_a=["p1", "p2"],
            team_b=["p3", "p4"]
        )
        h1 = next(h for h in res["calculated_holes"] if h["hole"] == 1)
        self.assertTrue(h1["match"]["played"])
        self.assertEqual(h1["match"]["won_point"], 3) # 2 base hands + 1 penetrate/chuan sweep bonus

        # Check player total cash
        p1 = next(p for p in res["player_scorecards"] if p["id"] == "p1")
        self.assertEqual(p1["total_cash"], 300.0)

    def test_update_players_lineup(self):
        # Change player lineup to 5 players
        new_players = [
            {"id": "p1", "name": "Shiro", "color": "#FFFFFF", "hcp_out": 1, "hcp_in": 1},
            {"id": "p2", "name": "Kuro", "color": "#1E293B", "hcp_out": 0, "hcp_in": 0},
            {"id": "p3", "name": "Aka", "color": "#EF4444", "hcp_out": 0, "hcp_in": 0},
            {"id": "p4", "name": "Ao", "color": "#3B82F6", "hcp_out": 2, "hcp_in": 2},
            {"id": "p5", "name": "Midori", "color": "#10B981", "hcp_out": 0, "hcp_in": 0}
        ]
        res = self.store.update_players(new_players)
        self.assertEqual(len(res["players"]), 5)
        self.assertEqual(res["players"][4]["name"], "Midori")

    def test_update_game_settings(self):
        res = self.store.update_settings({
            "game_settings": {
                "game_mode": "WOLF",
                "cash_per_point": 200,
                "turbo": True,
                "turbo_multiplier": 5,
                "penetrate": True,
                "penetrate_bonus": 2
            }
        })
        self.assertEqual(res["game_settings"]["game_mode"], "WOLF")
        self.assertEqual(res["game_settings"]["cash_per_point"], 200)
        self.assertEqual(res["game_settings"]["penetrate_bonus"], 2)

    def test_update_course_specs(self):
        new_holes = [
            {"hole": 1, "par": 5, "handicap": 3, "is_turbo": False},
            {"hole": 2, "par": 3, "handicap": 17, "is_turbo": False}
        ]
        res = self.store.update_course({
            "course_id": "course-custom",
            "course_name": "Custom Links",
            "holes": new_holes
        })
        self.assertEqual(res["course_id"], "course-custom")
        self.assertEqual(res["course_name"], "Custom Links")

if __name__ == "__main__":
    unittest.main()
