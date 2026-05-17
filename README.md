# GeoGuess — a static GeoGuessr clone

A fully-static GeoGuessr-style game that runs on GitHub Pages. **No backend
server, no Google Maps, no billing required.** Uses:

- **Mapillary** for crowd-sourced street-level imagery (free API tier)
- **Leaflet + OpenStreetMap** for the base map (no key, no cost)
- **Supabase Realtime** for multiplayer room sync (free Spark plan, no card)

Single player + 2–4 player multiplayer rooms via 6-character codes.

- 5 rounds per game (configurable)
- 60-second timer per round (configurable)
- 600+ curated worldwide coordinates with smart fallback if no Mapillary
  coverage exists at the chosen spot
- Score: `5000 * exp(-distanceKm / 2000)`

> ⚠️ **Coverage heads-up:** Mapillary is crowd-sourced and noticeably patchier
> than Google Street View, especially in rural areas and parts of Asia. The
> resolver tries 25 nearby curated points before falling back to random world
> coordinates, so games will still work, but they'll lean toward
> well-traveled cities.

---

## 1. Get a Mapillary access token (free)

1. Go to <https://www.mapillary.com/dashboard/developers> (sign up if needed —
   any email, no credit card).
2. Click **Register Application**. Name it anything, pick "Read public data".
3. After creating, click **View** on your app and grab the **Client Token**.
   It looks like `MLY|123456789012345|abcdef0123456789abcdef0123456789`.
4. (Optional) The token is read-only and rate-limited per application — safe
   to ship in client code, but rotate it if you ever see abuse.

## 2. Set up Supabase (free Spark plan, no card)

1. Go to <https://supabase.com/> and sign in.
2. Click **New project**. Pick any name, any region (closest to your players).
   Set a database password (won't matter — we don't touch the DB).
3. Wait ~1 minute for provisioning.
4. Open **Project Settings → API**. Copy:
   - **Project URL** → goes in `SUPABASE_URL` (looks like
     `https://abcdefgh.supabase.co`)
   - **anon / public key** → goes in `SUPABASE_ANON_KEY` (very long JWT-style
     string starting with `eyJ...`)

That's it — we only use Supabase Realtime Channels (broadcast + presence),
which work out of the box with no schema, no auth, no row-level-security
configuration. The `anon` key is designed to be public.

> Free plan limits: 200 concurrent realtime connections, 2 million messages
> per month. A 4-player game uses ~50 messages. You'd need ~40,000 games per
> month to hit the cap.

## 3. Create `config.js`

```bash
cp config.example.js config.js
```

Edit `config.js`:

```js
export const CONFIG = {
  MAPILLARY_TOKEN: "MLY|123...|abc...",
  SUPABASE_URL: "https://yourproj.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  ROUND_TIME_SECONDS: 60,
  ROUNDS_PER_GAME: 5,
  MAX_PLAYERS: 4,
  SEARCH_RADIUS_METERS: 4000
};
```

`config.js` is in `.gitignore` so it never lands on GitHub.

## 4. Run locally

ES modules need to be served over HTTP (not `file://`):

```bash
# pick one
python -m http.server 8000
npx serve .
php -S localhost:8000
```

Open <http://localhost:8000>.

## 5. Deploy to GitHub Pages with secrets

This is the recommended path so your tokens never enter git history.

1. Push the code to GitHub:
   ```bash
   git add .
   git commit -m "Initial GeoGuess clone"
   git push origin main
   ```
2. In your repo: **Settings → Secrets and variables → Actions → New repository
   secret**. Add these three (exact names):

   | Secret | Value |
   |---|---|
   | `MAPILLARY_TOKEN` | Your `MLY\|...\|...` token |
   | `SUPABASE_URL` | `https://yourproj.supabase.co` |
   | `SUPABASE_ANON_KEY` | Your long `eyJ...` anon key |

3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions** tab → re-run the deploy workflow (or push any commit).
5. After ~30s your site is live at
   `https://<your-username>.github.io/<repo-name>/`.

The workflow at `.github/workflows/deploy.yml` writes a fresh `config.js`
from those secrets at build time, then uploads the whole site to Pages.

## 6. Play

- **Single player** — click *Single Player*. 5 rounds, 60 seconds each.
- **Multiplayer host** — type your name, click *Create Multiplayer Room*.
  Share the 6-character code shown in the lobby.
- **Multiplayer guest** — enter the code, type your name, *Join*.
- Host clicks *Start Game* in the lobby when everyone's in. All players see
  the same panorama and guess independently within the time limit. Results
  appear when everyone has guessed (or the timer runs out).

---

## File structure

```
/
├── index.html
├── config.js              # gitignored — your tokens
├── config.example.js
├── style.css
├── js/
│   ├── main.js            # entry, library readiness check, UI wiring
│   ├── game.js            # round loop, scoring, state machine
│   ├── streetview.js      # Mapillary viewer + nearest-image search
│   ├── map.js             # Leaflet guess/result/final maps
│   ├── score.js           # haversine + 5000 * exp(-km/2000)
│   ├── multiplayer.js     # Supabase Realtime channels, lobby, sync
│   └── ui.js              # screen transitions, toast, HUD helpers
├── locations/
│   └── curated.js         # 600+ worldwide coordinates
├── .github/workflows/
│   └── deploy.yml         # builds config.js from secrets, deploys to Pages
└── README.md
```

## How multiplayer works (no DB schema)

All synchronization uses **Supabase Realtime Channels** — purely ephemeral,
no tables. The channel name is `geoguess:<ROOMCODE>`.

- **Presence** tracks who's in the room (name, host flag, `guessed` flag).
  Auto-cleaned on disconnect.
- **Broadcast events** carry game state:
  - `game_start` (host → all): seed + indices for the 5 rounds
  - `round_start` (host → all): round number
  - `guess` (each player → host): their guess + score
  - `round_results` (host → all): everyone's guesses for the round
  - `game_end` (host → all): final leaderboard

The host is the source of truth: it broadcasts the random seed at game start
so every client picks the same 5 locations from the curated list, collects
guesses each round, and broadcasts the aggregated results.

If the host leaves mid-game, the room dies. Players can return to menu and
make a new one. No persistent state means no cleanup logic needed.

## Troubleshooting

- **"Mapillary SDK not loaded"** → `unpkg.com` is blocked or slow. Wait a
  moment, or self-host the Mapillary/Leaflet files.
- **"Could not find a Mapillary panorama"** → your token is wrong or
  rate-limited. Check the network tab for a 401/429 on
  `graph.mapillary.com`.
- **Black panorama / no imagery loads** → the curated point has no nearby
  Mapillary coverage. The resolver should auto-retry, but if it keeps
  happening, increase `SEARCH_RADIUS_METERS` in `config.js`.
- **"Room not found"** → the host hasn't joined yet, or already left. Codes
  use a 0/1/I/O-free alphabet so confusion isn't the cause.
- **"Supabase not configured"** → fill in `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` in `config.js`.

## Notes on the open stack

- **No billing required** anywhere. Mapillary, OpenStreetMap (via CARTO
  tiles), and Supabase free tier are all credit-card-free.
- **Mapillary attribution is required** by their TOS and shown by the viewer
  by default. Don't disable it.
- **CARTO basemap attribution** is hidden in the UI for layout reasons; if
  you make this public, consider re-enabling `attributionControl: true` in
  `js/map.js` (it's the polite/legal thing to do).
