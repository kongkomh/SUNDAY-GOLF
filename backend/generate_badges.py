import os

uploads_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "uploads")
os.makedirs(uploads_dir, exist_ok=True)

schools = [
    {
        "file": "tsis.svg",
        "name": "TSIS",
        "primary": "#003366",
        "secondary": "#C8102E",
        "text": "TSIS",
        "sub": "SINGAPORE",
        "symbol": "🦁"
    },
    {
        "file": "ris.svg",
        "name": "RIS",
        "primary": "#002B49",
        "secondary": "#F2A900",
        "text": "RIS",
        "sub": "RUAMRUDEE",
        "symbol": "⭐"
    },
    {
        "file": "basis.svg",
        "name": "BASIS",
        "primary": "#981D2F",
        "secondary": "#0C2340",
        "text": "BASIS",
        "sub": "BANGKOK",
        "symbol": "🎓"
    },
    {
        "file": "kings.svg",
        "name": "King's College",
        "primary": "#00247D",
        "secondary": "#C8102E",
        "text": "KING'S",
        "sub": "BANGKOK",
        "symbol": "👑"
    },
    {
        "file": "wellington.svg",
        "name": "Wellington",
        "primary": "#0B1B3D",
        "secondary": "#C5A059",
        "text": "WCIB",
        "sub": "WELLINGTON",
        "symbol": "🛡️"
    },
    {
        "file": "bcb.svg",
        "name": "Brighton BCB",
        "primary": "#003865",
        "secondary": "#E5A823",
        "text": "BCB",
        "sub": "BRIGHTON",
        "symbol": "🦅"
    },
    {
        "file": "bangkok_prep.svg",
        "name": "Bangkok Prep",
        "primary": "#0F2042",
        "secondary": "#F4B223",
        "text": "PREP",
        "sub": "BKK PREP",
        "symbol": "🌳"
    },
    {
        "file": "kensington.svg",
        "name": "Kensington",
        "primary": "#1B4D3E",
        "secondary": "#F0A830",
        "text": "KENS",
        "sub": "KENSINGTON",
        "symbol": "🌿"
    },
    {
        "file": "concordian.svg",
        "name": "Concordian CIS",
        "primary": "#582C83",
        "secondary": "#FFC72C",
        "text": "CIS",
        "sub": "CONCORDIAN",
        "symbol": "🐉"
    },
    {
        "file": "harrow.svg",
        "name": "Harrow Bangkok",
        "primary": "#00205B",
        "secondary": "#C59B27",
        "text": "HARROW",
        "sub": "BANGKOK",
        "symbol": "🦁"
    },
    {
        "file": "shrewsbury.svg",
        "name": "Shrewsbury",
        "primary": "#133B5C",
        "secondary": "#E5A823",
        "text": "SHB",
        "sub": "SHREWSBURY",
        "symbol": "⛵"
    },
    {
        "file": "standrews.svg",
        "name": "St. Andrews",
        "primary": "#800020",
        "secondary": "#4A90E2",
        "text": "STA",
        "sub": "ST. ANDREWS",
        "symbol": "⚔️"
    },
    {
        "file": "kis.svg",
        "name": "KIS",
        "primary": "#003B71",
        "secondary": "#FF7A00",
        "text": "KIS",
        "sub": "BANGKOK",
        "symbol": "🔥"
    },
    {
        "file": "dulwich.svg",
        "name": "Dulwich",
        "primary": "#002454",
        "secondary": "#5C93C4",
        "text": "DULWICH",
        "sub": "COLLEGE",
        "symbol": "⚜️"
    },
    {
        "file": "isb.svg",
        "name": "ISB",
        "primary": "#111827",
        "secondary": "#F59E0B",
        "text": "ISB",
        "sub": "PANTHERS",
        "symbol": "🐾"
    }
]

for s in schools:
    clean_id = s['text'].replace("'", "").replace(" ", "_")
    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="grad_{clean_id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{s['primary']}" />
      <stop offset="100%" stop-color="{s['secondary']}" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.5"/>
    </filter>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#grad_{clean_id})" stroke="{s['secondary']}" stroke-width="3" filter="url(#shadow)"/>
  <circle cx="50" cy="50" r="40" fill="{s['primary']}" stroke="{s['secondary']}" stroke-width="1" opacity="0.95"/>
  <text x="50" y="37" font-family="system-ui, -apple-system, sans-serif" font-size="20" text-anchor="middle" dominant-baseline="central">{s['symbol']}</text>
  <text x="50" y="58" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="13" fill="#FFFFFF" text-anchor="middle" letter-spacing="1">{s['text']}</text>
  <text x="50" y="73" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="7" fill="{s['secondary']}" text-anchor="middle" letter-spacing="0.5">{s['sub']}</text>
</svg>'''
    filepath = os.path.join(uploads_dir, s["file"])
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Created {s['file']}")

print("All 15 badges generated successfully.")
