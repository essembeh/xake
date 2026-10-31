# CLAUDE.md

Xake ("chess" in Basque): a chess training web app. Play Stockfish or Maia at a chosen Elo, best moves
on demand, evaluation graph with annotated mistakes, variations, bookmarks, shareable links, PWA.
Design decisions live in `docs/specs/*.md` (001 MVP, 002 UX, 003 i18n, 004 game analysis, 005 browser
engine, 006 Maia opponent, 007 static site): read the relevant spec before changing a behaviour, update
it when a decision changes.

## Architecture

A **static site, no backend** (spec 007): npm + Vite, plain JavaScript (no TypeScript), every engine
runs in the browser.

- `index.html`: the page (Vite root), loads `config.js` then `src/js/main.js`.
- `src/js/`: ES modules, npm imports (`chess.js`, `chessground`, `onnxruntime-web/wasm`).
  - `main.js`: app controller (rendering, engine/analysis requests, actions, shortcuts).
  - `tree.js`: game = tree of moves (first child = main line), bookmarks, undo snapshots.
  - `storage.js`: `localStorage`, keys `xake:v1:*`, one key per game.
  - `i18n.js`: `en`/`fr` dictionaries, `t()`, `data-i18n*` attributes in `index.html`.
  - `engine.js`: Stockfish WebAssembly in Web Workers (pools `play`, Elo-limited, and `analyse`),
    Elo → UCI options (spec 001 §4), analysis keeps only exact infos of the deepest complete depth,
    fixed node budgets (spec 005 §9); `engineMove` dispatches to Stockfish or Maia, the opponent stored
    with each game (spec 006).
  - `maia.js`: Maia networks on ONNX Runtime Web, lc0 board encoding, move drawn among those ≥ 10%.
  - `share.js`: game ⇄ URL fragment; `pgn.js`: PGN export/import (import = main line only).
  - `evaluation.js`, `timeline.js`, `themes.js`, `sounds.js`.
- `src/css/app.css`, imported by `main.js` after chessground's base CSS.
- `public/` (served as is, not hashed): `config.js` (service settings, rewritten by the Docker image),
  `sw.js` (network-first service worker), manifest, icons, Lichess piece sets (`pieces/`, committed),
  Maia networks (`maia/`, fetched by `scripts/fetch-maia.sh`, never committed).
- `vite.config.js`: `base: "./"` (root and sub-path), app version (`package.json`) injected as
  `__APP_VERSION__`, Stockfish worker + wasm copied unbundled to `stockfish/`.
- **Deployment**: GitHub Pages (demo, from `main`) and the Docker image (`Dockerfile`: Node build, then
  nginx-unprivileged on port 8000, `docker/nginx.conf`, `docker/40-xake-config.sh` for `XAKE_*`).
  CI `.github/workflows/release.yml`: lint, e2e, image tested then pushed to `ghcr.io/essembeh/xake`,
  untagged images deleted, Pages deploy.

## Commands

npm scripts are the project interface (Node 24, `engines`), `package.json` holds all their settings.
On this NixOS machine there is no global Node: run them through `nix-shell -p nodejs_24 --run '…'`, and Playwright through
`scripts/nix-playwright.sh '…'` (browsers from nixpkgs, `@playwright/test` pinned to their version).

| Script | What |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:8000`, hot reload (fetches the Maia networks first) |
| `npm run build` / `npm run preview` | build into `dist/` / serve it on port 8000 |
| `npm run lint` / `npm run format` | Prettier (width 120), check / fix |
| `npm test` | Playwright smoke test of the engines, Chromium + WebKit, against the built site |
| `npm run screenshots [-- url]` | regenerate `docs/screenshots/` from a running dev server |
| `npm run release -- <bump>` | release: bump, commit `🔖 New release: X.Y.Z`, tag `X.Y.Z`, then push |

`lint` and `test` are distinct gates, both must pass before a change is ready.

## Environment gotchas

- "Start the dev server": run `npm run dev` in the background, then open the page in Firefox on the
  machine's LAN IP, never `localhost`:
  `firefox "http://$(ip -4 route get 1.1.1.1 | grep -oP 'src \K\S+'):8000/"`. Plain HTTP on a
  non-localhost address is not a secure context: no service worker, no clipboard API.
- The engines live in the front-end, which has no unit tests: run `npm test` after an engine or build
  change, and check UI changes in a browser. Never measure engine speed with Playwright's Firefox (12×
  slower than a real Firefox, spec 005 §9).

## Keeping docs in step with each change

Every requested change is done when these are up to date, in the same change:

- **Specs**: update the existing `docs/specs/*.md` that describes the behaviour (new decision,
  abandoned option and why); a new spec only for a new area. A comment citing a spec section
  means that section must exist.
- **Translations**: every new or changed string in **English and French** (`src/js/i18n.js`, plus the
  English fallback text in `index.html` markup).
- **Screenshots**: a visible UI change may outdate `docs/screenshots/`: check them, regenerate with
  `npm run screenshots` (dev server running) and adapt `scripts/screenshots.js` if the flow changed.
  Wait for the UI to be validated before regenerating.
- **README**: keep the Features list (and shortcuts, captions) in line with what the app does.

## Conventions

- Code, comments and docs in English; specs in French. Comments of 1–2 lines, reasoning goes to the specs.
- Prettier formats the code (`npm run format`); no linter beyond it (spec 007 §2.1).
- Every user-facing string goes through `t()` with keys in **both** dictionaries of `src/js/i18n.js`;
  static markup uses `data-i18n*` attributes. Move notation stays English SAN.
- New `XAKE_*` setting: `public/config.js` (default), `docker/40-xake-config.sh` (validation), README
  configuration table.
- Bump `xake:v1:` storage keys only with a migration: users would lose their games.
- Icons are inline SVG symbols in `index.html`; CSS styles icons through `button svg`, never a bare
  `svg` selector (it would restyle chessground's arrows).
