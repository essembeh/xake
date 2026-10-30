# CLAUDE.md

Xake ("chess" in Basque): a chess training web app. Play Stockfish at a chosen Elo, best moves on
demand, evaluation graph with annotated mistakes, variations, bookmarks, shareable links, PWA.
Design decisions live in `docs/specs/*.md` (001 MVP, 002 UX, 003 i18n, 004 game analysis, 005 browser engine): read the relevant spec
before changing a behaviour, update it when a decision changes.

## Architecture

- **Backend** (`src/xake/`): FastAPI, **stateless**, no database, **no engine**: Stockfish runs in the
  browser only (spec 005 §10). The backend serves the static app and the service settings.
  - `routers/api.py`: `/api/version`, the readiness probe of the chart (no liveness probe).
  - `routers/web.py`: `/config.js` (service settings for the front: default language, Elo, opponent
    movetime), root icons for iOS.
  - `schema/settings.py` + `settings.py`: `XAKE_*` environment variables.
  - `webapp.py`: `create_app(settings)`, static files mounted last.
- **Front-end** (`src/xake/static/`): plain ES modules, **no build, no npm**.
  - `js/main.js`: app controller (rendering, engine/analysis requests, actions, shortcuts).
  - `js/tree.js`: game = tree of moves (first child = main line), bookmarks, undo snapshots.
  - `js/storage.js`: `localStorage`, keys `xake:v1:*`, one key per game.
  - `js/i18n.js`: `en`/`fr` dictionaries, `t()`, `data-i18n*` attributes in `index.html`.
  - `js/engine.js`: Stockfish WebAssembly in Web Workers (pools `play`, Elo-limited, and `analyse`),
    Elo → UCI options (spec 001 §4), analysis keeps only exact infos of the deepest complete depth,
    fixed node budgets (spec 005 §9).
  - `js/share.js`: game ⇄ URL fragment; `js/pgn.js`: PGN export/import (import = main line only).
  - `js/evaluation.js`, `js/timeline.js`, `js/themes.js`, `js/sounds.js`.
  - `vendor/`: chessground, chess.js, stockfish.js (lite WebAssembly) and Lichess piece sets (free licences only), pinned and fetched by
    `scripts/vendor.sh` (`just vendor`) with curl. Never edit by hand.
  - `sw.js`: network-first service worker (app shell offline, API never cached).
- **Deployment**: `Dockerfile` (uv multi-stage, no engine in the image),
  Helm chart `charts/xake/`, CI `.github/workflows/release.yml` (image `ghcr.io/essembeh/xake`,
  chart published by chart-releaser on tags).

## Commands

The `Justfile` is the project interface:

| Recipe | What |
| --- | --- |
| `just check` | ruff format --check, ruff check, mypy strict on `src` and `tests` |
| `just test` | pytest + coverage |
| `just audit` | pip-audit |
| `just chart` | helm lint + template |
| `just webapp` | dev server with reload on `0.0.0.0:8000` |
| `just docker` | build and run the image with podman |
| `just e2e [url]` | smoke test of the browser engine in Chromium and WebKit (Playwright, dev server running) |
| `just screenshots [url]` | regenerate `docs/screenshots/` (Playwright, browsers from nixpkgs) |
| `just vendor` | refresh pinned front-end assets |
| `just release [bump]` / `just publish` | version bump + chart version + tag, then push |

`check` and `test` are distinct gates, both must pass before a change is ready.

## Environment gotchas

- "Start the dev server": run `just webapp` in the background, then open the page in Firefox on the
  machine's LAN IP, never `localhost`:
  `firefox "http://$(ip -4 route get 1.1.1.1 | grep -oP 'src \K\S+'):8000/"`. Plain HTTP on a
  non-localhost address is not a secure context: no service worker, no clipboard API.
- The engine lives in the front-end, which has no unit tests: run `just e2e` after an engine
  change, and check UI changes in a browser (Playwright from nixpkgs, see the `screenshots` recipe for the NixOS incantation). Never
  measure engine speed with Playwright's Firefox (12× slower than a real Firefox, spec 005 §9).

## Keeping docs in step with each change

Every requested change is done when these are up to date, in the same change:

- **Specs**: update the existing `docs/specs/*.md` that describes the behaviour (new decision,
  abandoned option and why); a new spec only for a new area. A comment citing a spec section
  means that section must exist.
- **Translations**: every new or changed string in **English and French** (`js/i18n.js`, plus the
  English fallback text in `index.html` markup).
- **Screenshots**: a visible UI change may outdate `docs/screenshots/`: check them, regenerate with
  `just screenshots` (dev server running) and adapt `scripts/screenshots.py` if the flow changed.
  Wait for the UI to be validated before regenerating.
- **README**: keep the Features list (and shortcuts, captions) in line with what the app does.

## Conventions

- Python conventions: Seb's `seb-python` skill (uv only, ruff, mypy strict, line length 120,
  comments of 1–2 lines max, reasoning goes to the specs).
- Code, comments and docs in English; specs in French.
- Every user-facing string goes through `t()` with keys in **both** dictionaries of `js/i18n.js`;
  static markup uses `data-i18n*` attributes. Move notation stays English SAN.
- New `XAKE_*` setting: `schema/settings.py`, chart `values.yaml` + `deployment.yaml` + chart
  README table, root README configuration table.
- Bump `xake:v1:` storage keys only with a migration: users would lose their games.
- Icons are inline SVG symbols in `index.html`; CSS styles icons through `button svg`, never a bare
  `svg` selector (it would restyle chessground's arrows).
