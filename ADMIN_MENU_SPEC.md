# Admin Console Specification (Sunday Golf Tracker)
**Target Account**: `kongkomh@gmail.com`

---

## 1. Overview & Objective
An exclusive administrative management console for **kongkomh@gmail.com** to:
1. **Manage Account-to-Player Linking**: Manually link or unlink any Google user account (`users` table) to/from any player profile (`players` table).
2. **Permanent Database Deletion (Players & Rounds)**:
   - **Delete Players**: Permanently delete any player profile from the database (`players`, `user_players`, `player_round_history`).
   - **Delete Any Round**: Permanently delete any round in the database (regardless of owner), cleaning up associated records and recalculating affected players' WHS handicaps.
3. **Manual-Rounds Creation & Integration**: 
   - Manually created rounds are full **first-class rounds** in the database called **`manual-rounds`** (ID prefix `manual-round-...`).
   - Show up in **My Saved Rounds** with a distinct `MANUAL` badge.
   - When opened:
     - **Only the Leaderboard is active and displayed**.
     - **Live Scoring, Scorecard, Cash Momentum, and Game Settings are disabled**.
   - Lineup & Score inputs:
     - Course, Tee (Course Rating & Slope), Date, Currency.
     - Add / remove players in the round.
     - Enter Gross Score and Money Won/Lost per player.
     - **Blank Score Handling**: If a player's score is left blank, it is **excluded from the WHS handicap calculation**, while their money won/lost is still recorded in their cash balance and round history.

---

## 2. Security & Access Control Architecture

### 2.1. Backend Guard
* Define `ADMIN_EMAILS = {"kongkomh@gmail.com"}` in `backend/auth.py` or `backend/server.py`.
* Provide a `@require_admin` decorator:
  ```python
  def require_admin(f):
      @wraps(f)
      def decorated(*args, **kwargs):
          user = get_current_user()
          if not user or (user.get("email") or "").lower() not in ADMIN_EMAILS:
              return jsonify({"error": "Admin access required"}), 403
          return f(*args, **kwargs)
      return decorated
  ```

### 2.2. Frontend Guard
* In `frontend/app.js`: Check `state.currentUser?.email === 'kongkomh@gmail.com'`.
* Only when authenticated as `kongkomh@gmail.com`:
  * Add the **Admin Console** button (`🛡️ Admin Console`) into the top-left dropdown menu (`top-dropdown-menu`).
  * Render `#admin-console-modal`.

---

## 3. Feature 1: User Account Linking & Player Database Management

### 3.1. Account Linking & Unlinking:
1. **View All Users**: Shows list of registered Google users (`id`, `email`, `name`, `created_at`).
2. **Current Linked Status**: Shows which player profile (`nickname`, `full_name`) is linked to each user.
3. **Unlink Action**:
   * Clears `players.user_id = NULL` for the linked player.
   * Disconnects the link without deleting match or scoring history.
4. **Link Action**:
   * Select a Google user and select an existing player.
   * Sets `players.user_id = user_id` and updates `players.email = user.email`.
   * Adds the player to the user's roster in `user_players`.

### 3.2. Permanent Player Deletion:
* **Admin Player Directory Table**: Lists all players with Nickname, Full Name, Email, Linked Google User, Current Handicap, and Actions.
* **Delete Player Action**:
  - Deletes from `players` table: `DELETE FROM players WHERE id = ?`.
  - Cleans up rosters: `DELETE FROM user_players WHERE player_id = ?`.
  - Cleans up scoring history: `DELETE FROM player_round_history WHERE player_id = ?`.
  - Confirmation modal required before deletion.

### API Endpoints:
* `GET /api/admin/accounts`: Returns all users and all players with current link mapping.
* `POST /api/admin/link`: Body: `{ "user_id": "...", "player_id": "..." }`.
* `POST /api/admin/unlink`: Body: `{ "player_id": "..." }`.
* `DELETE /api/admin/players/<player_id>`: Permanently deletes player and associated history from the database.

---

## 4. Feature 2: All Rounds Management & Database Deletion

### Capabilities:
* **All Rounds Table**:
  - Displays every round in the database across all users.
  - Columns: Round Type (`Live` / `Finished` / `Manual`), Round Identity (Date • Course), Creator/Owner Name, Player Count, Created At, Actions.
* **Delete Round Action**:
  - Permanently removes the round from `rounds` table regardless of who created it.
  - Deletes any round records from `player_round_history`: `DELETE FROM player_round_history WHERE round_id = ?`.
  - Automatically triggers WHS handicap recalculation for all affected players who had scores in that round.
  - Confirmation modal required before deletion.

### API Endpoints:
* `GET /api/admin/all-rounds`: Returns all rounds stored in the database with creator info and player counts.
* `DELETE /api/admin/rounds/<round_id>`: Permanently deletes the round and re-runs WHS recalculation for affected players.

---

## 5. Feature 3: Manual-Rounds Lifecycle & Integration

### 5.1. Creation in Admin Console:
1. **Round Parameters**:
   * **Course**: Dropdown from course catalog.
   * **Tee**: Dropdown of tees for that course (Course Rating and Slope Rating).
   * **Date**: Date picker (`YYYY-MM-DD`).
   * **Currency**: Dropdown (`THB`, `USD`, `EUR`, `GBP`, etc.).
2. **Player Lineup**:
   * Add any player to the round using the player selector.
   * Enter optional **Gross Score** (if blank, exempt from handicap calculation).
   * Enter **Money Won / Lost** (e.g. `+500`, `-300`).
   * Remove button to take players out of lineup.
3. **Database Persistence**:
   * **`rounds` table**: Saved with `is_manual: true`, `is_finished: true`, `owner_id: user.id`. This ensures it appears in the creator's **My Saved Rounds**.
   * **`player_round_history` table**:
     * For players with a gross score: computes differential and updates player's WHS Handicap Index per USGA Rule 5.2a.
     * For players with blank score: stores `gross_score = NULL`, `differential = NULL`, and records cash won/lost without touching their handicap index.

### 5.2. Display in "My Saved Rounds":
* In `#my-rounds-modal`, manual-rounds appear with:
  * Status Badge: `MANUAL` (styled with a distinct blue badge: `bg-sky-500/20 text-sky-300 border border-sky-500/30`).
  * Date, Course Name, Creator Name, and Player Names.
  * `Open` button to view the round.
  * `Delete` button to remove the round and roll back handicap and cash changes.

### 5.3. Viewing a Manual-Round: Disabled Navigation Tabs:
When a manual-round is loaded:
1. **Automatic Navigation**: App immediately switches to the **Leaderboard** tab (`switchTab('leaderboard')`).
2. **Disabled Tabs**:
   - **Live Scoring (`tab-btn-play`)**: Disabled (`opacity-40 pointer-events-none cursor-not-allowed`).
   - **Scorecard (`tab-btn-scorecard`)**: Disabled.
   - **Cash Momentum (`tab-btn-momentum`)**: Disabled.
   - **Game Settings (`tab-btn-settings`)**: Disabled.
   - Only **Leaderboard (`tab-btn-leaderboard`)** is clickable and active.
3. **Banner Notice**:
   - A clear banner on the Leaderboard tab:
     `📌 Manual Round • Hole-by-hole live scoring, scorecard, cash momentum, and game settings are disabled.`
4. **Leaderboard Display**:
   - Shows all players in the manual round, ranked by gross score (or cash won).
   - Displays gross score (or `-` if blank), differential (or `-` if blank), and money won/lost.
