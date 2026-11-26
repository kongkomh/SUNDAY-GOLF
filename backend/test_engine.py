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
        # Birdie win (2 pts) + default Lone Wolf Bonus (1 pt) = 3 pts per opponent -> Wolf +9, Losers -3 each
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

        self.assertEqual(p1["total_points"], 9.0)
        self.assertEqual(p1["total_cash"], 900.0)
        self.assertEqual(p2["total_points"], -3.0)
        self.assertEqual(p2["total_cash"], -300.0)
        self.assertEqual(p3["total_points"], -3.0)
        self.assertEqual(p3["total_cash"], -300.0)
        self.assertEqual(p4["total_points"], -3.0)
        self.assertEqual(p4["total_cash"], -300.0)

    def test_lone_wolf_bonus_win_loss_tie_turbo_and_partner(self):
        # 1) Par win (1 pt) + Lone Wolf Bonus (1 pt) -> Wolf +6, Losers -2 each
        par_win = calculate_tournament_state({
            "game_settings": {"game_mode": "WOLF", "hand_count": 1, "cash_per_point": 100, "lone_wolf_bonus": 1, "turbo": False},
            "players": self.players,
            "holes": self.holes,
            "scores": {"1": {"team_a": ["p1"], "team_b": ["p2", "p3", "p4"], "scores": {"p1": 4, "p2": 5, "p3": 5, "p4": 5}}}
        })
        sc_win = {p["id"]: p["total_points"] for p in par_win["player_scorecards"]}
        self.assertEqual(sc_win, {"p1": 6.0, "p2": -2.0, "p3": -2.0, "p4": -2.0})

        # 2) Lone Wolf loses (Par 4 by opponent vs Bogey 5 by Wolf) -> Bonus NOT applied -> Wolf -3, Winners +1 each
        wolf_loss = calculate_tournament_state({
            "game_settings": {"game_mode": "WOLF", "hand_count": 1, "cash_per_point": 100, "lone_wolf_bonus": 1, "turbo": False},
            "players": self.players,
            "holes": self.holes,
            "scores": {"1": {"team_a": ["p1"], "team_b": ["p2", "p3", "p4"], "scores": {"p1": 5, "p2": 4, "p3": 5, "p4": 5}}}
        })
        sc_loss = {p["id"]: p["total_points"] for p in wolf_loss["player_scorecards"]}
        self.assertEqual(sc_loss, {"p1": -3.0, "p2": 1.0, "p3": 1.0, "p4": 1.0})

        # 3) Lone Wolf ties -> Bonus NOT applied -> all 0
        wolf_tie = calculate_tournament_state({
            "game_settings": {"game_mode": "WOLF", "hand_count": 1, "cash_per_point": 100, "lone_wolf_bonus": 2, "turbo": False},
            "players": self.players,
            "holes": self.holes,
            "scores": {"1": {"team_a": ["p1"], "team_b": ["p2", "p3", "p4"], "scores": {"p1": 4, "p2": 4, "p3": 5, "p4": 5}}}
        })
        sc_tie = {p["id"]: p["total_points"] for p in wolf_tie["player_scorecards"]}
        self.assertEqual(sc_tie, {"p1": 0.0, "p2": 0.0, "p3": 0.0, "p4": 0.0})

        # 4) Turbo Hole 9 (x4) + Birdie (2 pts) + Lone Wolf Bonus (1 pt): (2 * 4) + 1 = 9 per opponent -> Wolf +27, Losers -9 each
        turbo_win = calculate_tournament_state({
            "game_settings": {"game_mode": "WOLF", "hand_count": 1, "cash_per_point": 100, "birdie_point": 2, "turbo": True, "turbo_multiplier": 4, "lone_wolf_bonus": 1},
            "players": self.players,
            "holes": self.holes,
            "scores": {"9": {"team_a": ["p1"], "team_b": ["p2", "p3", "p4"], "scores": {"p1": 3, "p2": 4, "p3": 5, "p4": 5}}}
        })
        sc_turbo = {p["id"]: p["total_points"] for p in turbo_win["player_scorecards"]}
        self.assertEqual(sc_turbo, {"p1": 27.0, "p2": -9.0, "p3": -9.0, "p4": -9.0})

        # 5) Wolf with Partner (2v2) wins -> Lone Wolf Bonus NOT applied -> +1 / -1
        partner_win = calculate_tournament_state({
            "game_settings": {"game_mode": "WOLF", "hand_count": 1, "cash_per_point": 100, "lone_wolf_bonus": 3, "turbo": False},
            "players": self.players,
            "holes": self.holes,
            "scores": {"1": {"team_a": ["p1", "p2"], "team_b": ["p3", "p4"], "scores": {"p1": 4, "p2": 5, "p3": 5, "p4": 5}}}
        })
        sc_partner = {p["id"]: p["total_points"] for p in partner_win["player_scorecards"]}
        self.assertEqual(sc_partner, {"p1": 1.0, "p2": 1.0, "p3": -1.0, "p4": -1.0})

        # 6) Lone Wolf Bonus set to 0 -> Par win gives +3 / -1
        zero_bonus = calculate_tournament_state({
            "game_settings": {"game_mode": "WOLF", "hand_count": 1, "cash_per_point": 100, "lone_wolf_bonus": 0, "turbo": False},
            "players": self.players,
            "holes": self.holes,
            "scores": {"1": {"team_a": ["p1"], "team_b": ["p2", "p3", "p4"], "scores": {"p1": 4, "p2": 5, "p3": 5, "p4": 5}}}
        })
        sc_zero = {p["id"]: p["total_points"] for p in zero_bonus["player_scorecards"]}
        self.assertEqual(sc_zero, {"p1": 3.0, "p2": -1.0, "p3": -1.0, "p4": -1.0})

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

    def test_teams_mode_default_teams(self):
        # Configure players with specific default teams: p1, p3 Left; p2, p4 Right
        players = [
            {"id": "p1", "name": "Shirobon", "color": "#FFFFFF", "default_team": "left"},
            {"id": "p2", "name": "Kurobon", "color": "#1E293B", "default_team": "right"},
            {"id": "p3", "name": "Akabon", "color": "#EF4444", "default_team": "left"},
            {"id": "p4", "name": "Aobon", "color": "#3B82F6", "default_team": "right"}
        ]
        game_data = {
            "game_settings": {
                "game_mode": "TEAMS",
                "hand_count": 2,
                "cash_per_point": 100,
                "penetrate": False,
                "turbo": False
            },
            "players": players,
            "holes": self.holes,
            "scores": {
                "1": {
                    "scores": {"p1": 4, "p2": 5, "p3": 4, "p4": 5}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        self.assertEqual(state["game_settings"]["game_mode"], "TEAMS")
        self.assertEqual(state["default_team_a"], ["p1", "p3"])
        self.assertEqual(state["default_team_b"], ["p2", "p4"])
        h1 = next(h for h in state["calculated_holes"] if h["hole"] == 1)
        self.assertEqual(h1["team_a"], ["p1", "p3"])
        self.assertEqual(h1["team_b"], ["p2", "p4"])
        # Team Left (p1, p3) both shot 4 vs Team Right (p2, p4) both shot 5 -> Left wins!
        p1 = next(p for p in state["player_scorecards"] if p["id"] == "p1")
        p2 = next(p for p in state["player_scorecards"] if p["id"] == "p2")
        self.assertEqual(p1["total_points"], 2.0)
        self.assertEqual(p2["total_points"], -2.0)

    def test_free_for_all_3_players(self):
        # 3 players: A (p1), B (p2), C (p3) on Par 4 hole.
        # p1: raw 3 (Birdie, weight 2)
        # p2: raw 4 (Par, weight 1)
        # p3: raw 5 (Bogey, weight 1)
        # Combinations:
        # A vs B: A wins (Birdie, 2 pts). A: +2, B: -2
        # A vs C: A wins (Birdie, 2 pts). A: +2, C: -2
        # B vs C: B wins (Par, 1 pt). B: +1, C: -1
        # Net deltas:
        # A: +4 pts
        # B: -1 pt
        # C: -3 pts
        # Total: 0 (Zero-Sum!)
        players = [
            {"id": "p1", "name": "A", "color": "#FFFFFF", "hcp_out": 0, "hcp_in": 0},
            {"id": "p2", "name": "B", "color": "#1E293B", "hcp_out": 0, "hcp_in": 0},
            {"id": "p3", "name": "C", "color": "#EF4444", "hcp_out": 0, "hcp_in": 0}
        ]
        game_data = {
            "game_settings": {
                "game_mode": "FREE_FOR_ALL",
                "cash_per_point": 100,
                "birdie_point": 2,
                "turbo": False
            },
            "players": players,
            "holes": self.holes,
            "scores": {
                "1": {
                    "scores": {"p1": 3, "p2": 4, "p3": 5}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        self.assertEqual(state["game_settings"]["game_mode"], "FREE_FOR_ALL")
        h1 = next(h for h in state["calculated_holes"] if h["hole"] == 1)
        self.assertTrue(h1["match"]["played"])
        self.assertEqual(len(h1["match"]["matchups"]), 3)

        p1 = next(p for p in state["player_scorecards"] if p["id"] == "p1")
        p2 = next(p for p in state["player_scorecards"] if p["id"] == "p2")
        p3 = next(p for p in state["player_scorecards"] if p["id"] == "p3")

        self.assertEqual(p1["total_points"], 4.0)
        self.assertEqual(p1["total_cash"], 400.0)
        self.assertEqual(p2["total_points"], -1.0)
        self.assertEqual(p2["total_cash"], -100.0)
        self.assertEqual(p3["total_points"], -3.0)
        self.assertEqual(p3["total_cash"], -300.0)
        self.assertEqual(p1["total_points"] + p2["total_points"] + p3["total_points"], 0.0)

    def test_free_for_all_4_players_zero_sum(self):
        # 4 players: 6 pairwise combinations
        game_data = {
            "game_settings": {
                "game_mode": "FREE_FOR_ALL",
                "cash_per_point": 100,
                "turbo": False
            },
            "players": self.players,
            "holes": self.holes,
            "scores": {
                "1": {
                    "scores": {"p1": 4, "p2": 4, "p3": 5, "p4": 6}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        h1 = next(h for h in state["calculated_holes"] if h["hole"] == 1)
        self.assertEqual(len(h1["match"]["matchups"]), 6)
        total_pts = sum(p["total_points"] for p in state["player_scorecards"])
        total_cash = sum(p["total_cash"] for p in state["player_scorecards"])
        self.assertAlmostEqual(total_pts, 0.0)
        self.assertAlmostEqual(total_cash, 0.0)

    def test_free_for_all_turbo_and_tiebreaker(self):
        # Hole 9 is a Turbo Hole (Par 4). Turbo multiplier is 3.
        # Player p1 has handicap on H9 (if allowed) or test tiebreaker without handicap.
        # p1: raw 3 (Birdie, weight 2)
        # p2: raw 3 (Birdie, weight 2) -> Tie (0 pts)
        # p3: raw 4 (Par, weight 1)
        # p1 vs p3: p1 Birdie (2 pts) * 3 turbo = 6 pts
        # p2 vs p3: p2 Birdie (2 pts) * 3 turbo = 6 pts
        # p1 vs p2: Tie (0 pts)
        # Totals: p1 = +6, p2 = +6, p3 = -12. Sum = 0!
        players = [
            {"id": "p1", "name": "A", "color": "#FFFFFF", "hcp_out": 0, "hcp_in": 0},
            {"id": "p2", "name": "B", "color": "#1E293B", "hcp_out": 0, "hcp_in": 0},
            {"id": "p3", "name": "C", "color": "#EF4444", "hcp_out": 0, "hcp_in": 0}
        ]
        game_data = {
            "game_settings": {
                "game_mode": "FREE_FOR_ALL",
                "cash_per_point": 100,
                "birdie_point": 2,
                "turbo": True,
                "turbo_multiplier": 3
            },
            "players": players,
            "holes": self.holes,
            "scores": {
                "9": {
                    "scores": {"p1": 3, "p2": 3, "p3": 4}
                }
            }
        }
        state = calculate_tournament_state(game_data)
        h9 = next(h for h in state["calculated_holes"] if h["hole"] == 9)
        self.assertTrue(h9["match"]["is_turbo"])
        p1 = next(p for p in state["player_scorecards"] if p["id"] == "p1")
        p2 = next(p for p in state["player_scorecards"] if p["id"] == "p2")
        p3 = next(p for p in state["player_scorecards"] if p["id"] == "p3")
        self.assertEqual(p1["total_points"], 6.0)
        self.assertEqual(p2["total_points"], 6.0)
        self.assertEqual(p3["total_points"], -12.0)
        self.assertEqual(p1["total_cash"], 600.0)
        self.assertEqual(p2["total_cash"], 600.0)
        self.assertEqual(p3["total_cash"], -1200.0)

    def test_wolf_turbo_holes_front_back_alternation(self):
        from engine import compute_wolf_turbo_holes, get_played_hole_order
        for sh in [1, 10]:
            seq = get_played_hole_order(sh)
            front_set = set(seq[:9])
            back_set = set(seq[9:])
            turbo = compute_wolf_turbo_holes(self.players, self.holes, starting_hole=sh)
            self.assertEqual(len(turbo), 4, f"Expected 4 turbo holes, got {len(turbo)}")
            front_count = sum(1 for h in turbo if h in front_set)
            back_count = sum(1 for h in turbo if h in back_set)
            self.assertEqual(front_count, 2, f"Starting hole {sh}: Expected 2 in front 9, got {front_count}")
            self.assertEqual(back_count, 2, f"Starting hole {sh}: Expected 2 in back 9, got {back_count}")

if __name__ == "__main__":
    unittest.main()
