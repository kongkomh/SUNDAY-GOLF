"""
Sunday Golf Tracker - 1 Group Casual Golf Engine (3–6 Players)
Game Modes: NORMAL & WOLF
Features:
- Handicap (TOR) Hole Allocator (OUT/IN)
- Turbo Holes & Multipliers
- Penetrate (Chuan) Sweep Bonus
- Best X Balls (Hand Count) Match Resolver
- Zero-Sum Points & Cash Distribution
"""

from typing import Dict, List, Any, Optional, Set, Tuple
import copy

DEFAULT_PLAYERS = [
    {
        "id": "p1",
        "name": "Shirobon",
        "color": "#FFFFFF",
        "hcp_out": 0,
        "hcp_in": 0
    },
    {
        "id": "p2",
        "name": "Kurobon",
        "color": "#1E293B",
        "hcp_out": 0,
        "hcp_in": 0
    },
    {
        "id": "p3",
        "name": "Akabon",
        "color": "#EF4444",
        "hcp_out": 0,
        "hcp_in": 0
    },
    {
        "id": "p4",
        "name": "Aobon",
        "color": "#3B82F6",
        "hcp_out": 0,
        "hcp_in": 0
    }
]

DEFAULT_PLAYER_COLORS = [
    "#FFFFFF",  # P1: White (Shirobon)
    "#1E293B",  # P2: Black (Kurobon)
    "#EF4444",  # P3: Red (Akabon)
    "#3B82F6",  # P4: Blue (Aobon)
    "#10B981",  # P5: Green (Midoribon)
    "#F59E0B"   # P6: Yellow (Kibon)
]

DEFAULT_PLAYER_NAMES = [
    "Shirobon",
    "Kurobon",
    "Akabon",
    "Aobon",
    "Midoribon",
    "Kibon"
]

DEFAULT_SETTINGS = {
    "game_mode": "NORMAL",         # "NORMAL" or "WOLF"
    "hand_count": 2,               # Best X Balls (1 to num_players)
    "cash_per_point": 100,         # Cash per point / hole
    "currency": "THB",             # Currency code: THB (฿), USD ($), EUR (€), etc.
    "turbo": True,                 # Turbo hole enabled (default checked)
    "turbo_multiplier": 2,         # Multiplier on turbo holes (default 2 for NORMAL, num_players for WOLF)
    "turbo_handicap": False,       # Allow handicap on turbo holes (default unchecked)
    "penetrate": True,             # Penetrate / Chuan bonus enabled (default checked)
    "penetrate_bonus": 1,          # Additional point when all hands are won
    "birdie_point": 2,             # Points for birdie
    "eagle_point": 3,              # Points for eagle
    "albatross_point": 4           # Points for albatross
}

DEFAULT_HOLES = [
    {"hole": 1, "par": 4, "handicap": 7, "is_turbo": False},
    {"hole": 2, "par": 4, "handicap": 11, "is_turbo": False},
    {"hole": 3, "par": 3, "handicap": 15, "is_turbo": False},
    {"hole": 4, "par": 5, "handicap": 3, "is_turbo": False},
    {"hole": 5, "par": 4, "handicap": 1, "is_turbo": False},
    {"hole": 6, "par": 4, "handicap": 9, "is_turbo": False},
    {"hole": 7, "par": 3, "handicap": 17, "is_turbo": False},
    {"hole": 8, "par": 5, "handicap": 5, "is_turbo": False},
    {"hole": 9, "par": 4, "handicap": 13, "is_turbo": True},
    {"hole": 10, "par": 4, "handicap": 8, "is_turbo": False},
    {"hole": 11, "par": 5, "handicap": 4, "is_turbo": False},
    {"hole": 12, "par": 3, "handicap": 16, "is_turbo": False},
    {"hole": 13, "par": 4, "handicap": 2, "is_turbo": False},
    {"hole": 14, "par": 4, "handicap": 10, "is_turbo": False},
    {"hole": 15, "par": 4, "handicap": 12, "is_turbo": False},
    {"hole": 16, "par": 3, "handicap": 18, "is_turbo": False},
    {"hole": 17, "par": 5, "handicap": 6, "is_turbo": False},
    {"hole": 18, "par": 4, "handicap": 14, "is_turbo": True}
]


def allocate_player_handicap_holes(player: Dict[str, Any], holes: List[Dict[str, Any]], turbo_handicap: bool = False) -> Set[int]:
    """
    Determines which hole numbers (1-18) this player receives a -1 handicap stroke.
    Rules:
    - Front 9 (H1-H9): apply to non-Par 3 holes. If turbo_handicap is False, skip turbo holes.
      Sort remaining candidate holes by stroke handicap index (least handicap index = hardest hole first).
      Allocate to the top `hcp_out` holes.
    - Back 9 (H10-H18): apply to non-Par 3 holes. If turbo_handicap is False, skip turbo holes.
      Sort remaining candidate holes by stroke handicap index.
      Allocate to the top `hcp_in` holes.
    """
    hcp_out = int(player.get("hcp_out", 0) or 0)
    hcp_in = int(player.get("hcp_in", 0) or 0)
    
    h_out_candidates = []
    h_in_candidates = []

    for h in holes:
        h_num = int(h["hole"])
        par = int(h.get("par", 4))
        is_turbo = bool(h.get("is_turbo", False))
        hcp_index = int(h.get("handicap", 9))

        # Skip Par 3s
        if par == 3:
            continue
        # Skip turbo holes if turbo_handicap is False
        if not turbo_handicap and is_turbo:
            continue

        if 1 <= h_num <= 9:
            h_out_candidates.append((hcp_index, h_num))
        elif 10 <= h_num <= 18:
            h_in_candidates.append((hcp_index, h_num))

    # Sort candidate holes by handicap index ascending (lowest index = hardest first)
    h_out_candidates.sort(key=lambda x: x[0])
    h_in_candidates.sort(key=lambda x: x[0])

    allocated: Set[int] = set()

    for _, h_num in h_out_candidates[:max(0, hcp_out)]:
        allocated.add(h_num)

    for _, h_num in h_in_candidates[:max(0, hcp_in)]:
        allocated.add(h_num)

    return allocated


def get_all_players_handicap_map(players: List[Dict[str, Any]], holes: List[Dict[str, Any]], turbo_handicap: bool = False) -> Dict[str, Set[int]]:
    """
    Returns a dict { player_id: set_of_handicap_hole_numbers }
    """
    res = {}
    for p in players:
        p_id = p.get("id", "")
        res[p_id] = allocate_player_handicap_holes(p, holes, turbo_handicap)
    return res


def compute_wolf_turbo_holes(players: List[Dict[str, Any]], holes: List[Dict[str, Any]]) -> List[int]:
    """
    In Wolf mode:
    - Hole 9 and Hole 18 are always turbo holes.
    - Assign remaining wolves their turbo holes (non-par 3):
      - Front 9 turbo hole assigned to wolf closest to Hole 9 (non-par 3).
      - Back 9 turbo hole assigned to wolf closest to Hole 18 (non-par 3).
    """
    turbo_holes = [9, 18]
    n_players = len(players)
    if n_players <= 2:
        return turbo_holes

    # Find non-Par 3 holes in front 9 closest to 9 (descending from 8 down to 1)
    f9_candidates = [h["hole"] for h in holes if 1 <= h["hole"] <= 8 and h.get("par", 4) != 3]
    f9_candidates.sort(key=lambda h: abs(h - 9))

    # Find non-Par 3 holes in back 9 closest to 18 (descending from 17 down to 10)
    b9_candidates = [h["hole"] for h in holes if 10 <= h["hole"] <= 17 and h.get("par", 4) != 3]
    b9_candidates.sort(key=lambda h: abs(h - 18))

    if f9_candidates:
        turbo_holes.append(f9_candidates[0])
    if b9_candidates:
        turbo_holes.append(b9_candidates[0])

    return sorted(list(set(turbo_holes)))


def get_wolf_rotation_for_hole(hole_num: int, players: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    For a given hole (1-18), determines:
    - wolf_player: Player object who is the wolf
    - tee_order: List of Player objects in the order they tee off (Wolf tees off LAST)
    - default_team_a: [wolf_id]
    - default_team_b: [other player_ids in tee order]
    """
    n = len(players)
    if n == 0:
        return {"wolf": None, "tee_order": [], "default_team_a": [], "default_team_b": []}

    wolf_idx = (hole_num - 1) % n
    wolf = players[wolf_idx]

    # Tee off order: the player after the wolf tees off 1st, then 2nd... up to Wolf who tees off last
    tee_order = []
    for i in range(1, n):
        idx = (wolf_idx + i) % n
        tee_order.append(players[idx])
    tee_order.append(wolf)

    sheep = [p for p in tee_order if p["id"] != wolf["id"]]

    return {
        "wolf": wolf,
        "tee_order": tee_order,
        "default_team_a": [wolf["id"]],
        "default_team_b": [p["id"] for p in sheep]
    }


def calculate_hole_points(
    hole_num: int,
    hole_spec: Dict[str, Any],
    team_a_ids: List[str],
    team_b_ids: List[str],
    player_scores: Dict[str, Optional[int]],
    player_handicap_map: Dict[str, Set[int]],
    settings: Dict[str, Any],
    players_dict: Dict[str, Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Calculates point outcome for a single hole between Team A and Team B.
    Follows pseudocode for hand matching, turbo multiplier, penetrate (chuan) bonus,
    and zero-sum player distribution.
    """
    par = int(hole_spec.get("par", 4))
    is_turbo = bool(hole_spec.get("is_turbo", False))
    turbo_enabled = bool(settings.get("turbo", False))
    turbo_mult = int(settings.get("turbo_multiplier", 2) or 2)
    penetrate_enabled = bool(settings.get("penetrate", False))
    penetrate_bonus = int(settings.get("penetrate_bonus", 1) or 1)
    game_mode = str(settings.get("game_mode", "NORMAL")).upper()
    setting_hand_count = int(settings.get("hand_count", 2) or 2)

    birdie_pt = int(settings.get("birdie_point", 2) or 2)
    eagle_pt = int(settings.get("eagle_point", 3) or 3)
    albatross_pt = int(settings.get("albatross_point", 4) or 4)

    # Filter team_a_ids and team_b_ids strictly to valid players in players_dict
    valid_team_a_ids = [pid for pid in team_a_ids if pid in players_dict]
    valid_team_b_ids = [pid for pid in team_b_ids if pid in players_dict]

    # Collect team A & team B player data for this hole
    team_a_data = []
    for pid in valid_team_a_ids:
        raw_score = player_scores.get(pid)
        if raw_score is not None:
            has_hcp = (hole_num in player_handicap_map.get(pid, set()))
            net_score = (raw_score - 1) if has_hcp else raw_score
            team_a_data.append({
                "id": pid,
                "player": players_dict[pid],
                "raw_score": raw_score,
                "net_score": net_score,
                "has_hcp": has_hcp
            })

    team_b_data = []
    for pid in valid_team_b_ids:
        raw_score = player_scores.get(pid)
        if raw_score is not None:
            has_hcp = (hole_num in player_handicap_map.get(pid, set()))
            net_score = (raw_score - 1) if has_hcp else raw_score
            team_b_data.append({
                "id": pid,
                "player": players_dict[pid],
                "raw_score": raw_score,
                "net_score": net_score,
                "has_hcp": has_hcp
            })

    # If any team is empty or missing scores, hole cannot be resolved
    if not team_a_data or not team_b_data:
        return {
            "played": False,
            "won_point": 0,
            "base_points": 0,
            "hand_count": 0,
            "hand_won_count": 0,
            "is_turbo": is_turbo,
            "is_penetrate": False,
            "point_deltas": {p: 0.0 for p in players_dict},
            "team_a_sorted": team_a_data,
            "team_b_sorted": team_b_data
        }

    # Sort players in team_a and team_b by lowest net score
    team_a_data.sort(key=lambda p: (p["net_score"], p["raw_score"]))
    team_b_data.sort(key=lambda p: (p["net_score"], p["raw_score"]))

    # Determine hand count: min(settings.hand_count, len(team_a), len(team_b))
    hand_count = min(setting_hand_count, len(team_a_data), len(team_b_data))
    if hand_count < 1:
        hand_count = 1

    won_point = 0
    hand_won_count = 0
    hand_details = []

    for hand in range(hand_count):
        p_a = team_a_data[hand]
        p_b = team_b_data[hand]

        # Lower score wins hand
        if p_a["net_score"] < p_b["net_score"]:
            hand_won_count += 1
            diff = p_a["raw_score"] - par
            if diff <= -3:
                pts = albatross_pt
            elif diff == -2:
                pts = eagle_pt
            elif diff == -1:
                pts = birdie_pt
            else:
                pts = 1
            won_point += pts
            hand_details.append({"hand": hand + 1, "winner": "team_a", "points": pts, "p_a": p_a, "p_b": p_b})

        elif p_b["net_score"] < p_a["net_score"]:
            hand_won_count -= 1
            diff = p_b["raw_score"] - par
            if diff <= -3:
                pts = albatross_pt
            elif diff == -2:
                pts = eagle_pt
            elif diff == -1:
                pts = birdie_pt
            else:
                pts = 1
            won_point -= pts
            hand_details.append({"hand": hand + 1, "winner": "team_b", "points": -pts, "p_a": p_a, "p_b": p_b})

        else:
            # Tied hand
            hand_details.append({"hand": hand + 1, "winner": "tie", "points": 0, "p_a": p_a, "p_b": p_b})

    base_points = won_point

    # Turbo bonus multiplier
    if turbo_enabled and is_turbo:
        won_point = won_point * turbo_mult

    # Penetrate (Chuan) bonus if hand_count > 1 and all hands won
    is_penetrate = False
    if penetrate_enabled and hand_count > 1:
        if hand_won_count == hand_count: # Team A won all hands
            won_point += penetrate_bonus
            is_penetrate = True
        elif -hand_won_count == hand_count: # Team B won all hands
            won_point -= penetrate_bonus
            is_penetrate = True

    # Payout Distribution (Zero-Sum)
    point_deltas: Dict[str, float] = {p_id: 0.0 for p_id in players_dict}
    n_a = len(team_a_data)
    n_b = len(team_b_data)

    # WOLF MODE: LONE WOLF SCENARIO (hand_count == 1 and 1 player in Team A)
    if game_mode == "WOLF" and n_a == 1:
        # Team A is lone wolf. Total points lost/gain = number of players in Team B * won_point
        for p in team_b_data:
            point_deltas[p["id"]] = -float(won_point)
        lone_wolf_id = team_a_data[0]["id"]
        point_deltas[lone_wolf_id] = float(won_point) * n_b

    # NORMAL MODE or WOLF PARTNER SCENARIO
    else:
        if won_point > 0: # Team A won
            for p in team_b_data:
                point_deltas[p["id"]] = -float(won_point)
            for p in team_a_data:
                point_deltas[p["id"]] = float(won_point) * (n_b / n_a)
        elif won_point < 0: # Team B won
            for p in team_a_data:
                point_deltas[p["id"]] = float(won_point) # note won_point is negative
            for p in team_b_data:
                point_deltas[p["id"]] = -float(won_point) * (n_a / n_b)

    return {
        "played": True,
        "won_point": won_point,
        "base_points": base_points,
        "hand_count": hand_count,
        "hand_won_count": hand_won_count,
        "hand_details": hand_details,
        "is_turbo": is_turbo,
        "is_penetrate": is_penetrate,
        "point_deltas": point_deltas,
        "team_a_sorted": team_a_data,
        "team_b_sorted": team_b_data
    }


def calculate_tournament_state(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Computes full tournament/game state for the single group Sunday golf tracker:
    - 3 to 6 Players
    - Normal or Wolf Game Modes
    - Hole-by-hole scores, net scores, handicap assignments
    - Points and Cash calculations
    - Momentum tracking and Leaderboard
    """
    tournament_name = data.get("tournament_name", "Sunday Golf Match")
    course_name = data.get("course_name", "Krungthep Kreetha Golf Course")
    course_id = data.get("course_id", "course-krungthep-kreetha")

    # Game Settings
    settings = copy.deepcopy(DEFAULT_SETTINGS)
    settings.update(data.get("game_settings") or {})

    # Players (ensure 3 to 6 players with valid colors & defaults)
    raw_players = data.get("players") or copy.deepcopy(DEFAULT_PLAYERS)
    players: List[Dict[str, Any]] = []
    
    for idx, p in enumerate(raw_players):
        if idx >= 6:
            break
        p_id = p.get("id") or f"p{idx+1}"
        p_name = p.get("name") or DEFAULT_PLAYER_NAMES[min(idx, len(DEFAULT_PLAYER_NAMES)-1)]
        p_color = p.get("color") or DEFAULT_PLAYER_COLORS[min(idx, len(DEFAULT_PLAYER_COLORS)-1)]
        p_out = int(p.get("hcp_out", 0) or 0)
        p_in = int(p.get("hcp_in", 0) or 0)
        players.append({
            "id": p_id,
            "name": p_name,
            "color": p_color,
            "hcp_out": max(0, p_out),
            "hcp_in": max(0, p_in)
        })

    # Ensure minimum 3 players
    while len(players) < 3:
        idx = len(players)
        players.append({
            "id": f"p{idx+1}",
            "name": DEFAULT_PLAYER_NAMES[min(idx, len(DEFAULT_PLAYER_NAMES)-1)],
            "color": DEFAULT_PLAYER_COLORS[min(idx, len(DEFAULT_PLAYER_COLORS)-1)],
            "hcp_out": 0,
            "hcp_in": 0
        })

    players_dict = {p["id"]: p for p in players}

    # Adjust Turbo multiplier default for WOLF mode if not explicitly set
    if settings.get("game_mode") == "WOLF":
        if "turbo_multiplier" not in (data.get("game_settings") or {}):
            settings["turbo_multiplier"] = len(players)

    # Holes
    holes = copy.deepcopy(data.get("holes") or DEFAULT_HOLES)
    # Ensure 18 holes
    if len(holes) < 18:
        holes = copy.deepcopy(DEFAULT_HOLES)

    # In WOLF mode with turbo enabled, adjust turbo flags if needed
    if settings.get("game_mode") == "WOLF" and settings.get("turbo"):
        wolf_turbos = compute_wolf_turbo_holes(players, holes)
        for h in holes:
            h["is_turbo"] = (h["hole"] in wolf_turbos)

    # Compute Handicap Allocations for all players
    turbo_handicap = bool(settings.get("turbo_handicap", False))
    player_handicap_map = get_all_players_handicap_map(players, holes, turbo_handicap)

    # Score entries per hole: dict of { "1": { "team_a": [...], "team_b": [...], "scores": { "p1": 4, ... } } }
    raw_scores = data.get("scores") or {}

    calculated_holes = []
    player_cum_points: Dict[str, float] = {p["id"]: 0.0 for p in players}
    player_cum_cash: Dict[str, float] = {p["id"]: 0.0 for p in players}
    player_gross_out: Dict[str, int] = {p["id"]: 0 for p in players}
    player_gross_in: Dict[str, int] = {p["id"]: 0 for p in players}
    player_gross_tot: Dict[str, int] = {p["id"]: 0 for p in players}
    player_played: Dict[str, int] = {p["id"]: 0 for p in players}
    player_to_par: Dict[str, int] = {p["id"]: 0 for p in players}
    player_momentum: Dict[str, List[Optional[float]]] = {p["id"]: [0.0] for p in players}
    player_hole_scores: Dict[str, Dict[str, Optional[int]]] = {p["id"]: {} for p in players}
    player_hole_net: Dict[str, Dict[str, Optional[int]]] = {p["id"]: {} for p in players}
    player_hole_pts: Dict[str, Dict[str, Optional[float]]] = {p["id"]: {} for p in players}
    player_hole_cash: Dict[str, Dict[str, Optional[float]]] = {p["id"]: {} for p in players}

    cash_per_point = int(settings.get("cash_per_point", 100) or 100)
    last_team_a = [players[0]["id"], players[1]["id"]] if len(players) >= 4 else [players[0]["id"]]
    last_team_b = [p["id"] for p in players if p["id"] not in last_team_a]

    max_thru = 0

    for h_spec in holes:
        h_num = int(h_spec["hole"])
        h_key = str(h_num)
        h_par = int(h_spec.get("par", 4))

        # Default team assignments for this hole
        if settings.get("game_mode") == "WOLF":
            wolf_info = get_wolf_rotation_for_hole(h_num, players)
            default_team_a = wolf_info["default_team_a"]
            default_team_b = wolf_info["default_team_b"]
            wolf_player = wolf_info["wolf"]
            tee_order = wolf_info["tee_order"]
        else:
            default_team_a = copy.deepcopy(last_team_a)
            default_team_b = copy.deepcopy(last_team_b)
            wolf_player = None
            tee_order = players

        h_entry = raw_scores.get(h_key, {})
        raw_team_a = h_entry.get("team_a")
        raw_team_b = h_entry.get("team_b")

        if raw_team_a is not None and raw_team_b is not None:
            team_a_ids = [pid for pid in raw_team_a if pid in players_dict]
            team_b_ids = [pid for pid in raw_team_b if pid in players_dict]
            # Ensure all players in players_dict are assigned
            for pid in players_dict:
                if pid not in team_a_ids and pid not in team_b_ids:
                    team_b_ids.append(pid)
        else:
            team_a_ids = [pid for pid in default_team_a if pid in players_dict]
            team_b_ids = [pid for pid in default_team_b if pid in players_dict]

        hole_scores_dict = h_entry.get("scores") or {}

        # Save team assignment for subsequent holes in normal mode
        if team_a_ids and team_b_ids:
            last_team_a = team_a_ids
            last_team_b = team_b_ids

        # Compute point match
        h_match = calculate_hole_points(
            h_num,
            h_spec,
            team_a_ids,
            team_b_ids,
            hole_scores_dict,
            player_handicap_map,
            settings,
            players_dict
        )

        # Update per-player stats for this hole
        hole_played_any = False

        for p in players:
            pid = p["id"]
            raw_s = hole_scores_dict.get(pid)
            player_hole_scores[pid][h_key] = raw_s

            if raw_s is not None:
                hole_played_any = True
                has_hcp = (h_num in player_handicap_map.get(pid, set()))
                net_s = (raw_s - 1) if has_hcp else raw_s
                player_hole_net[pid][h_key] = net_s

                player_gross_tot[pid] += raw_s
                player_played[pid] += 1
                player_to_par[pid] += (raw_s - h_par)

                if h_num <= 9:
                    player_gross_out[pid] += raw_s
                else:
                    player_gross_in[pid] += raw_s

                # Points and Cash
                pts_delta = h_match["point_deltas"].get(pid, 0.0)
                cash_delta = pts_delta * cash_per_point

                player_cum_points[pid] += pts_delta
                player_cum_cash[pid] += cash_delta

                player_hole_pts[pid][h_key] = pts_delta
                player_hole_cash[pid][h_key] = cash_delta
                player_momentum[pid].append(round(player_cum_cash[pid], 2))
            else:
                player_hole_net[pid][h_key] = None
                player_hole_pts[pid][h_key] = None
                player_hole_cash[pid][h_key] = None
                player_momentum[pid].append(None)

        if hole_played_any:
            max_thru = max(max_thru, h_num)

        # Angel wings list (players who have handicap on this hole)
        handicap_players = [
            players_dict[pid] for pid in players_dict
            if h_num in player_handicap_map.get(pid, set())
        ]

        calculated_holes.append({
            "hole": h_num,
            "par": h_par,
            "handicap": h_spec.get("handicap", 9),
            "is_turbo": h_spec.get("is_turbo", False),
            "team_a": team_a_ids,
            "team_b": team_b_ids,
            "scores": hole_scores_dict,
            "match": h_match,
            "wolf_player": wolf_player,
            "tee_order": tee_order,
            "handicap_players": handicap_players
        })

    # Prepare Player Scorecard Objects
    player_scorecards = []
    for p in players:
        pid = p["id"]
        played_count = player_played[pid]
        tot_to_par = player_to_par[pid]
        to_par_display = "E" if played_count == 0 else (f"{tot_to_par}" if tot_to_par < 0 else (f"+{tot_to_par}" if tot_to_par > 0 else "E"))
        thru_display = "F" if played_count == 18 else (f"Thru {played_count}" if played_count > 0 else "-")

        player_scorecards.append({
            "id": pid,
            "name": p["name"],
            "color": p["color"],
            "hcp_out": p["hcp_out"],
            "hcp_in": p["hcp_in"],
            "handicap_holes": sorted(list(player_handicap_map.get(pid, set()))),
            "scores": player_hole_scores[pid],
            "net_scores": player_hole_net[pid],
            "hole_points": player_hole_pts[pid],
            "hole_cash": player_hole_cash[pid],
            "out_gross": player_gross_out[pid] if played_count > 0 else None,
            "in_gross": player_gross_in[pid] if played_count > 9 else None,
            "total_gross": player_gross_tot[pid] if played_count > 0 else None,
            "total_played": played_count,
            "thru": played_count,
            "thru_display": thru_display,
            "total_to_par": tot_to_par if played_count > 0 else 0,
            "to_par_display": to_par_display,
            "total_points": round(player_cum_points[pid], 2),
            "total_cash": round(player_cum_cash[pid], 2),
            "momentum": player_momentum[pid],
            "rank": 0,
            "rank_display": "-"
        })

    # Rank players for Leaderboard (by Total Cash descending, then To-Par ascending, then Gross)
    def rank_key(p):
        if p["total_played"] == 0:
            return (1, 0, 0, 0)
        return (0, -p["total_cash"], p["total_to_par"], p["total_gross"] or 999)

    sorted_leaderboard = sorted(player_scorecards, key=rank_key)

    # Compute ranks with ties
    n_lb = len(sorted_leaderboard)
    i = 0
    curr_rank = 1
    while i < n_lb:
        if sorted_leaderboard[i]["total_played"] == 0:
            sorted_leaderboard[i]["rank"] = curr_rank
            sorted_leaderboard[i]["rank_display"] = "-"
            i += 1
            curr_rank += 1
            continue

        j = i
        while (j < n_lb and sorted_leaderboard[j]["total_played"] > 0 and
               sorted_leaderboard[j]["total_cash"] == sorted_leaderboard[i]["total_cash"] and
               sorted_leaderboard[j]["total_to_par"] == sorted_leaderboard[i]["total_to_par"]):
            j += 1

        is_tied = (j - i > 1)
        rank_str = f"T{curr_rank}" if is_tied else str(curr_rank)

        for k in range(i, j):
            sorted_leaderboard[k]["rank"] = curr_rank
            sorted_leaderboard[k]["rank_display"] = rank_str

        curr_rank += (j - i)
        i = j

    # Find current top earner
    leader_player = sorted_leaderboard[0] if sorted_leaderboard and sorted_leaderboard[0]["total_played"] > 0 else None

    # Course Specs
    total_par = sum(h.get("par", 4) for h in holes)
    out_par = sum(h.get("par", 4) for h in holes if h.get("hole", 1) <= 9)
    in_par = sum(h.get("par", 4) for h in holes if h.get("hole", 1) > 9)

    current_display_hole = min(18, max_thru + 1) if max_thru < 18 else 18

    return {
        "tournament_name": tournament_name,
        "course_id": course_id,
        "course_name": course_name,
        "game_settings": settings,
        "players": players,
        "holes": holes,
        "course_specs": {
            "total_par": total_par,
            "out_par": out_par,
            "in_par": in_par
        },
        "calculated_holes": calculated_holes,
        "player_scorecards": player_scorecards,
        "leaderboard": sorted_leaderboard,
        "leader_player": leader_player,
        "current_display_hole": current_display_hole,
        "max_thru": max_thru,
        "last_updated": data.get("last_updated")
    }
