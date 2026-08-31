"""
Unit tests for Sunday Golf Tracker Engine (Normal & Wolf Game Modes, TOR, Turbo, Chuan)
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
        # Player 1 has hcp_out=2, hcp_in=1
        # Front 9 candidate non-Par 3 holes (non-turbo when turbo_handicap=False):
        # Holes: H1 (7), H2 (11), H4 (3), H5 (1), H6 (9), H8 (5)
        # Sorted by handicap: H5 (1), H4 (3), H8 (5), H1 (7), H6 (9), H2 (11)
        # Top 2 are H5 and H4.
        # Back 9 candidate non-Par 3 holes:
        # Holes: H10 (8), H11 (4), H13 (2), H14 (10), H15 (12), H17 (6)
        # Sorted by handicap: H13 (2), H11 (4), H17 (6)...
        # Top 1 is H13.
        hcp_holes = allocate_player_handicap_holes(self.players[0], self.holes, turbo_handicap=False)
        self.assertIn(5, hcp_holes)
        self.assertIn(4, hcp_holes)
        self.assertIn(13, hcp_holes)
        self.assertNotIn(3, hcp_holes) # Par 3 never gets handicap
        self.assertNotIn(9, hcp_holes) # Turbo hole skipped when turbo_handicap is False

    def test_normal_mode_2v2_scoring(self):
        # 2v2 Match: Team A = [p1, p2], Team B = [p3, p4]
        # Hole 1: Par 4
        # p1 has raw score 4 (Par) -> Net 4 (no handicap on H1)
        # p2 has raw score 4 (Par) -> Net 4
        # p3 has raw score 5 (Bogey) -> Net 5
        # p4 has raw score 5 (Bogey) -> Net 5
        # Hand count = 2
        # Hand 1: p1 (4) vs p3 (5) -> Team A wins (+1 pt)
        # Hand 2: p2 (4) vs p4 (5) -> Team A wins (+1 pt)
        # Base won_point = +2
        # Penetrate (Chuan) is disabled by default
        # Payout: Team A (2 players) receives +2 * (2/2) = +2 each.
        # Team B (2 players) loses -2 each.
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
        # Enable Penetrate (Chuan) with bonus = 1
        # Team A wins all 2 hands -> base 2 pts + 1 penetrate bonus = 3 pts
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
        # Hole 9 is Turbo
        # Team A wins 1 point on turbo hole with multiplier = 3
        # Total won points = 1 * 3 = 3 pts
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
        # Hole 1: Wolf is Player 1 (p1). Lone wolf scenario: Team A = [p1], Team B = [p2, p3, p4]
        # p1 shoots 3 (Birdie on Par 4, birdie_point=2)
        # Sheep shoot 4, 5, 5
        # hand_count = 1
        # Hand 1: p1 (3) vs p2 (4) -> p1 wins with Birdie (+2 pts)
        # Payout:
        # Each sheep loses 2 pts (-200 cash)
        # Lone wolf gains 2 * 3 = +6 pts (+600 cash)
        # Zero-sum total: +600 - 200 - 200 - 200 = 0!
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

if __name__ == "__main__":
    unittest.main()
