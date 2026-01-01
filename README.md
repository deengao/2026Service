# Happy New Year 2026 — Three.js (Christian greeting)

Single-page static site:
- Shows: **Happy New Year 2026 — Brothers and Sisters**
- Displays your verse messages as a timed sequence
- Loads 2 animated GLB models (Garrosh + Butcher)
- Plays **walk** animation by default
- Switches both to **run** on the final line of the Philippians passage

## Run locally

```bash
python3 -m http.server 5173
```

Open:
- http://localhost:5173

## Assets (put in `assets/`)

- `assets/garrosh.glb`
- `assets/butcher.glb`
- `assets/greet2026.wav` (optional: plays when the verse crawl begins)
	- Also supported: `assets/greeting2026.wav`
- `assets/music.mp3` (optional: loops after the greeting audio finishes)

## Animations

The code auto-selects clips by name:
- Walk: looks for `walk`, then falls back to `run`, `idle`, `move`
- Run: looks for `run`, then falls back to `sprint`, `dash`, `walk`, `idle`

If your clip names are unusual, tell me the exact clip names and I’ll hard-select them.

## Add your exact verse text

Create a local file (not committed):

1) Copy `user-verses.example.js` → `user-verses.js`
2) Paste your exact wording into `lines`

The app will automatically load `user-verses.js`. If it’s missing, it shows placeholders.

(Reason: NIV text is copyrighted; easiest is you paste your exact wording locally.)
