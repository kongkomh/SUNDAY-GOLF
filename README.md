# ⛳ Sunday Golf Tracker - 1 Group Casual Golf & Wolf Game App

A real-time mobile web application designed for a casual Sunday golf game with **3 to 6 players**, supporting **NORMAL** and **WOLF** game modes, **Handicap (TOR)** stroke allocations, **Turbo** multipliers, **Penetrate (Chuan)** sweep bonuses, a pre-loaded **Courses Database**, and split **Team A / Team B** mobile scoring with live zero-sum cash calculations.

---

## 📋 Match Rules & Formats

| Feature | Details |
|---|---|
| **Players** | **3 to 6 Players** (single group). |
| **Player Colors** | P1: White (*Shirobon*), P2: Black (*Kurobon*), P3: Red (*Akabon*), P4: Blue (*Aobon*), P5: Green (*Midoribon*), P6: Yellow (*Kibon*). |
| **Game Modes** | **NORMAL** (Team match with free/copied assignment) or **WOLF** (Rotational Wolf tees off last; Lone Wolf or 1 Partner). |
| **Best X Balls** | Selectable 1 to $N$ balls compared between teams (`hand_count`, default 2). |
| **Betting Stakes** | Cash per point (default 100) with currency selector (THB ฿, USD $, EUR €, GBP £, JPY ¥, SGD S$). |
| **Handicap (TOR)** | -1 stroke applied on non-Par 3 holes with the lowest stroke index (hardest holes). Configurable OUT (H1-9) and IN (H10-18). |
| **Turbo Holes** | Points won on turbo holes are multiplied by the Turbo Multiplier (default x2 for Normal, x$N$ for Wolf). |
| **Penetrate (Chuan)** | If all hands are won by one side in a multi-hand match, an extra Penetrate/Chuan bonus is added to the winnings. |
| **Thai Edition** | When currency is Thai Baht (`THB`), all UI terminology automatically adapts ("Handicap" $\rightarrow$ **TOR / ต่อ**, "Penetrate" $\rightarrow$ **Chuan / ชวน**). |

---

## 🧮 World Handicap System (WHS) Handicap Calculation (USGA Rule 5.2a)

The app tracks each player's official **World Handicap System (WHS) Handicap Index** across their past rounds using the standard USGA Rule 5.2a formula.

### 1. Score Differential Formula

For each completed 18-hole round played on a rated course and tee:

$$\text{Score Differential} = \text{round}\left(\frac{113.0}{\text{Slope Rating}} \times (\text{Gross Score} - \text{Course Rating}), 1\right)$$

* **Gross Score**: Total 18-hole raw strokes.
* **Course Rating**: The evaluation of course difficulty for a scratch golfer (e.g. `71.5`).
* **Slope Rating**: The relative difficulty rating for non-scratch golfers compared to a standard rating of 113 (e.g. `126`).

---

### 2. Rounds Selection & Stroke Adjustment Table (USGA Rule 5.2a)

The system records up to the **20 most recent 18-hole rounds** played by each player. A minimum of **3 submitted scores** is required to establish an official Handicap Index.

The table below determines how many of the lowest differentials are used and the adjustment applied based on the number of scores in the player's record:

| Number of Scores Submitted | Number of Differentials Used | Adjustment (Strokes) | Calculation Procedure |
| :---: | :---: | :---: | :--- |
| **3** | Lowest 1 | -2.0 | Lowest differential minus 2.0 |
| **4** | Lowest 1 | -1.0 | Lowest differential minus 1.0 |
| **5** | Lowest 1 | 0 | Lowest differential |
| **6** | Average of lowest 2 | -1.0 | Average of lowest 2 differentials minus 1.0 |
| **7 – 8** | Average of lowest 2 | 0 | Average of lowest 2 differentials |
| **9 – 11** | Average of lowest 3 | 0 | Average of lowest 3 differentials |
| **12 – 14** | Average of lowest 4 | 0 | Average of lowest 4 differentials |
| **15 – 16** | Average of lowest 5 | 0 | Average of lowest 5 differentials |
| **17 – 18** | Average of lowest 6 | 0 | Average of lowest 6 differentials |
| **19** | Average of lowest 7 | 0 | Average of lowest 7 differentials |
| **20** | Average of lowest 8 | 0 *(Standard WHS)* | Average of lowest 8 differentials |

> **Rounding**: The resulting average (after applying adjustment strokes) is rounded to the nearest tenth (`0.1`).
>
> **Highlighting in App**: In the player's **Past Rounds** history modal, the differentials currently counting toward their Handicap Index are highlighted in **green with a star badge (`★ Used`)**, while non-counting differentials remain neutral.
>
> **Blank Score Exemption**: In manually inserted past rounds, if a player's gross score is left blank, it is excluded from the handicap calculation (`differential = NULL`), preserving their handicap index while still recording their money won/lost.

---

## 🏫 Pre-Loaded Golf Courses Database (`data/courses.json`)

1. **Krungthep Kreetha Golf Course** (Bangkok)
2. **The Royal Gems Golf City (RG City - Dream Arena)** (Pathum Thani)
3. **The Royal Gems Golf & Sports Club (Salaya)** (Nakhon Pathom)
4. **Thai Country Club** (Chachoengsao)
5. **Alpine Golf Club** (Pathum Thani)
6. **Riverdale Golf Club** (Pathum Thani)
7. **Thana City Country Club** (Samut Prakan)
8. **Bangkok Golf Club** (Pathum Thani)
9. **Marco Simone Golf & Country Club** (Rome)

---

## 🚀 Quick Start

```bash
# Run server directly with Python:
python backend/server.py 8080

# Or using launcher script:
./start.sh 8080
```
Open [http://localhost:8080](http://localhost:8080) in your mobile browser or desktop.

---

## 📱 Core Features & Tab Navigation

1. **🎯 Live Scoring Tab**:
   - Split two-column mobile layout for **Team A (Left)** and **Team B (Right)** (or **WOLF 🐺** vs **SHEEP 🐑**).
   - Drag-and-drop or tap-to-move player cards between sides.
   - Vertical score steppers (`+` / `−`) with instant re-ordering of lowest scoring players to the top.
   - Dynamic badges for 🔥 **Turbo** and 🪽 **Angel Wings (TOR)** showing player handicap allocations.
   - Post-save point & cash delta display (`+฿200` / `-฿200`).
2. **📊 Scorecard Tab**:
   - 18-hole gross scorecard matrix (H1–H18, OUT, IN, TOT, $+/-$ Par) with golf score symbology and TOR indicators.
3. **📈 Cash Momentum Tab**:
   - Chart.js graph tracking cumulative cash won or lost by each player across all 18 holes in their respective color codes.
4. **🏆 Leaderboard Tab**:
   - Ranked by total cash earned (green for `+`, red for `-`), displaying player colors, +/- par, gross score, and points.
5. **⚙️ Settings Tab**:
   - Adjust player count (3–6), names, color codes, and Handicap OUT/IN.
   - Toggle game modes (Normal vs Wolf), hand count, cash rate, turbo, turbo handicap, and penetrate/chuan bonuses.
   - Select and customize course pars, handicap stroke indices, and turbo holes.

---

## 📂 Project Structure

```
sunday-golf-tracker-app/
├── backend/
│   ├── engine.py              # Pure scoring engine (Normal/Wolf, TOR, Turbo, Chuan math)
│   ├── server.py              # Real-time HTTP & SSE Python server
│   └── test_engine.py         # Unit tests for scoring & payout logic
├── frontend/
│   ├── index.html             # Responsive single-page app
│   ├── styles.css             # Split dropzones, vertical dials, angel wing badges
│   └── app.js                 # Drag & drop, vertical dials, SSE client, Chart.js
├── data/
│   ├── courses.json           # Pre-loaded golf courses database
│   └── tournament_state.json  # Persistent JSON state
├── test_server_direct.py      # Direct store tests
├── test_server_api.py         # E2E HTTP integration tests
├── start.sh                   # Executable launcher
└── README.md
```