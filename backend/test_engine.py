"""
Unit tests for Sunday Golf Tracker Engine (Normal & Wolf Game Modes, TOR, Turbo, Chuan, Under-Par Raw Tiebreaker)
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from engine import (
    calculate_tournament_state,
    allocate_player_handicap_holes,
    calculate_hole_points,
    DEFAULT_PLAYERS,
    DEFAULT_HOLES,
    DEFAULT_SETTINGS
)

class TestSundayGolfEngine(unittest.TestCase):

    def setUp(self):
        self.players = [
            {"id": "p1", "name": "Shirobon", "color": "#FFFFFF", "hcp_out": 2, "hcp_in": 1},
            {"id": "p2", "name": "Kurobon", "color": "#1E293B", "hcp_out": 0, "hcp_in": 0},
            {"id": "p3", "name": "Akabon", "color": "#EF4444", "hcp_out": 0, "hcp_in": 0},
            {"id": "p4", "name": "Aobon", "color": "#3B82F6", "hcp_out": 1, "hcp_in": 2}
        ]
        self.holes = [
            {"hole": 1, "par": 4, "handicap": 7, "is_turbo": False},
            {"hole": 2, "par": 4, "handicap": 11, "is_turbo": False},
            {"hole": 3, "par": 3, "handicap": 15, "is_turbo": False}, # Par 3
            {"hole": 4, "par": 5, "handicap": 3, "is_turbo": False},
            {"hole": 5, "par": 4, "handicap": 1, "is_turbo": False},  # Hardest in Front 9
            {"hole": 6, "par": 4, "handicap": 9, "is_turbo": False},
            {"hole": 7, "par": 3, "handicap": 17, "is_turbo": False}, # Par 3
            {"hole": 8, "par": 5, "handicap": 5, "is_turbo": False},
            {"hole": 9, "par": 4, "handicap": 13, "is_turbo": True},  # Turbo Hole
            {"hole": 10, "par": 4, "handicap": 8, "is_turbo": False},
            {"hole": 11, "par": 5, "handicap": 4, "is_turbo": False},
            {"hole": 12, "par": 3, "handicap": 16, "is_turbo": False}, # Par 3
            {"hole": 13, "par": 4, "handicap": 2, "is_turbo": False},  # Hardest in Back 9
            {"hole": 14, "par": 4, "handicap": 10, "is_turbo": False},
            {"hole": 15, "par": 4, "handicap": 12, "is_turbo": False},
            {"hole": 16, "par": 3, "handicap": 18, "is_turbo": False}, # Par 3
            {"hole": 17, "par": 5, "handicap": 6, "is_turbo": False},
            {"hole": 18, "par": 4, "handicap": 14, "is_turbo": True}   # Turbo Hole
        ]

    def test_handicap_allocation_rules(self):
        hcp_holes = allocate_player_handicap_holes(self.players[0], self.holes, turbo_handicap=False)
        self.assertIn(5, hcp_holes)
        self.assertIn(4, hcp_holes)
        self.assertIn(13, hcp_holes)
        self.assertNotIn(3, hcp_holes) # Par 3 never gets handicap
        self.assertNotIn(9, hcp_holes) # Turbo hole skipped when turbo_handicap is False

    def test_normal_mode_2v2_scoring(self):
        game_data = {
            "tournament_name": "Test Sunday Game",
            "game_settings": {
                "game_mode": "NORMAL",
                "hand_count": 2,
                "cash_per_point": 100,
                "penetrate": False,
                "turbo": False
            },
            "players": self.players,
            "holes": self.holes,
            "scores": {
                "1": {
                    "team_a": ["p1", "p2"],
                    "team_b": ["p3", "p4"],
                    "scores": {"p1": 4, "p2": 4, "p3": 5, "p4": 5}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        p1 = next(p for p in state["player_scorecards"] if p["id"] == "p1")
        p2 = next(p for p in state["player_scorecards"] if p["id"] == "p2")
        p3 = next(p for p in state["player_scorecards"] if p["id"] == "p3")
        p4 = next(p for p in state["player_scorecards"] if p["id"] == "p4")

        self.assertEqual(p1["total_points"], 2.0)
        self.assertEqual(p1["total_cash"], 200.0)
        self.assertEqual(p2["total_points"], 2.0)
        self.assertEqual(p2["total_cash"], 200.0)
        self.assertEqual(p3["total_points"], -2.0)
        self.assertEqual(p3["total_cash"], -200.0)
        self.assertEqual(p4["total_points"], -2.0)
        self.assertEqual(p4["total_cash"], -200.0)

    def test_penetrate_chuan_bonus(self):
        game_data = {
            "game_settings": {
                "game_mode": "NORMAL",
                "hand_count": 2,
                "cash_per_point": 100,
                "penetrate": True,
                "penetrate_bonus": 1,
                "turbo": False
            },
            "players": self.players,
            "holes": self.holes,
            "scores": {
                "1": {
                    "team_a": ["p1", "p2"],
                    "team_b": ["p3", "p4"],
                    "scores": {"p1": 4, "p2": 4, "p3": 5, "p4": 5}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        p1 = next(p for p in state["player_scorecards"] if p["id"] == "p1")
        p3 = next(p for p in state["player_scorecards"] if p["id"] == "p3")
        self.assertEqual(p1["total_points"], 3.0)
        self.assertEqual(p1["total_cash"], 300.0)
        self.assertEqual(p3["total_points"], -3.0)
        self.assertEqual(p3["total_cash"], -300.0)

    def test_turbo_multiplier(self):
        game_data = {
            "game_settings": {
                "game_mode": "NORMAL",
                "hand_count": 1,
                "cash_per_point": 100,
                "turbo": True,
                "turbo_multiplier": 3
            },
            "players": self.players,
            "holes": self.holes,
            "scores": {
                "9": {
                    "team_a": ["p1", "p2"],
                    "team_b": ["p3", "p4"],
                    "scores": {"p1": 4, "p2": 5, "p3": 5, "p4": 6}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        p1 = next(p for p in state["player_scorecards"] if p["id"] == "p1")
        p3 = next(p for p in state["player_scorecards"] if p["id"] == "p3")
        self.assertEqual(p1["total_points"], 3.0)
        self.assertEqual(p3["total_points"], -3.0)

    def test_wolf_lone_wolf_scoring(self):
        game_data = {
            "game_settings": {
                "game_mode": "WOLF",
                "hand_count": 1,
                "cash_per_point": 100,
                "birdie_point": 2
            },
            "players": self.players,
            "holes": self.holes,
            "scores": {
                "1": {
                    "team_a": ["p1"],
                    "team_b": ["p2", "p3", "p4"],
                    "scores": {"p1": 3, "p2": 4, "p3": 5, "p4": 5}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        p1 = next(p for p in state["player_scorecards"] if p["id"] == "p1")
        p2 = next(p for p in state["player_scorecards"] if p["id"] == "p2")
        p3 = next(p for p in state["player_scorecards"] if p["id"] == "p3")
        p4 = next(p for p in state["player_scorecards"] if p["id"] == "p4")

        self.assertEqual(p1["total_points"], 6.0)
        self.assertEqual(p1["total_cash"], 600.0)
        self.assertEqual(p2["total_points"], -2.0)
        self.assertEqual(p2["total_cash"], -200.0)
        self.assertEqual(p3["total_points"], -2.0)
        self.assertEqual(p3["total_cash"], -200.0)
        self.assertEqual(p4["total_points"], -2.0)
        self.assertEqual(p4["total_cash"], -200.0)

    def test_underpar_raw_tiebreaker_case1(self):
        # Case 1: Hole 5 (Par 4). Player p1 has handicap on H5 -> raw 4 (Par) nets to 3.
        # Player p2 has no handicap -> raw 3 (Birdie) nets to 3.
        # Net scores tied (3 == 3), but p2 has raw Birdie (weight 2) vs p1 raw Par (weight 1).
        # Team B (p2) wins 2 - 1 = 1 point!
        h_match = calculate_hole_points(
            hole_num=5,
            hole_spec={"hole": 5, "par": 4, "handicap": 1, "is_turbo": False},
            team_a_ids=["p1"],
            team_b_ids=["p2"],
            player_scores={"p1": 4, "p2": 3},
            player_handicap_map={"p1": {5}, "p2": set()},
            settings={"game_mode": "NORMAL", "hand_count": 1, "birdie_point": 2, "turbo": False, "penetrate": False},
            players_dict={p["id"]: p for p in self.players}
        )
        self.assertEqual(h_match["won_point"], -1) # Team B won 1 point
        self.assertEqual(h_match["hand_details"][0]["winner"], "team_b")
        self.assertEqual(h_match["hand_details"][0]["points"], -1)

    def test_underpar_raw_tiebreaker_case2(self):
        # Case 2: Hole 5 (Par 4). Player p1 (handicap) raw 3 (Birdie) -> Net 2.
        # Player p2 (no handicap) raw 2 (Eagle) -> Net 2.
        # Net scores tied (2 == 2). p2 has Eagle (weight 3) vs p1 Birdie (weight 2).
        # Team B wins 3 - 2 = 1 point!
        h_match = calculate_hole_points(
            hole_num=5,
            hole_spec={"hole": 5, "par": 4, "handicap": 1, "is_turbo": False},
            team_a_ids=["p1"],
            team_b_ids=["p2"],
            player_scores={"p1": 3, "p2": 2},
            player_handicap_map={"p1": {5}, "p2": set()},
            settings={"game_mode": "NORMAL", "hand_count": 1, "birdie_point": 2, "eagle_point": 3, "turbo": False, "penetrate": False},
            players_dict={p["id"]: p for p in self.players}
        )
        self.assertEqual(h_match["won_point"], -1) # Team B won 1 point

    def test_underpar_raw_tiebreaker_case3(self):
        # Case 3: Hole 5 (Par 4). Player p1 (handicap) raw 3 (Birdie) -> Net 2.
        # Player p2 (no handicap) raw 4 (Par) -> Net 4.
        # Net score win for Team A (2 < 4). Winner p1 has raw Birdie -> 2 points.
        h_match = calculate_hole_points(
            hole_num=5,
            hole_spec={"hole": 5, "par": 4, "handicap": 1, "is_turbo": False},
            team_a_ids=["p1"],
            team_b_ids=["p2"],
            player_scores={"p1": 3, "p2": 4},
            player_handicap_map={"p1": {5}, "p2": set()},
            settings={"game_mode": "NORMAL", "hand_count": 1, "birdie_point": 2, "turbo": False, "penetrate": False},
            players_dict={p["id"]: p for p in self.players}
        )
        self.assertEqual(h_match["won_point"], 2) # Team A won 2 points

    def test_underpar_raw_tiebreaker_case4(self):
        # Case 4: Hole 5 (Par 4). Player p1 (handicap) raw 5 (Bogey) -> Net 4.
        # Player p2 (no handicap) raw 4 (Par) -> Net 4.
        # Net scores tied (4 == 4), but neither is under par (min(5, 4) < 4 is False).
        # Result: 0 points (Tied).
        h_match = calculate_hole_points(
            hole_num=5,
            hole_spec={"hole": 5, "par": 4, "handicap": 1, "is_turbo": False},
            team_a_ids=["p1"],
            team_b_ids=["p2"],
            player_scores={"p1": 5, "p2": 4},
            player_handicap_map={"p1": {5}, "p2": set()},
            settings={"game_mode": "NORMAL", "hand_count": 1, "turbo": False, "penetrate": False},
            players_dict={p["id"]: p for p in self.players}
        )
        self.assertEqual(h_match["won_point"], 0) # Tied hand

    def test_underpar_raw_tiebreaker_case5(self):
        # Case 5: Hole 5 (Par 4). Player p1 (handicap) raw 4 (Par) -> Net 3.
        # Player p2 (no handicap) raw 4 (Par) -> Net 4.
        # Outright Net Win for Team A (3 < 4). Winner p1 has raw Par -> 1 point.
        h_match = calculate_hole_points(
            hole_num=5,
            hole_spec={"hole": 5, "par": 4, "handicap": 1, "is_turbo": False},
            team_a_ids=["p1"],
            team_b_ids=["p2"],
            player_scores={"p1": 4, "p2": 4},
            player_handicap_map={"p1": {5}, "p2": set()},
            settings={"game_mode": "NORMAL", "hand_count": 1, "turbo": False, "penetrate": False},
            players_dict={p["id"]: p for p in self.players}
        )
        self.assertEqual(h_match["won_point"], 1) # Team A won 1 point

if __name__ == "__main__":
    unittest.main()
