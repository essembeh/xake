# CLAUDE.md

Xake ("chess" in Basque): a chess training web app. Play Stockfish at a chosen Elo, best moves on
demand, evaluation graph with annotated mistakes, variations, bookmarks, shareable links, PWA.
Design decisions live in `docs/specs/*.md` (001 MVP, 002 UX, 003 i18n): read the relevant spec
before changing a behaviour, update it when a decision changes.

## Architecture

- **Backend** (`src/xake/`): FastAPI, **stateless**, no database. Every request carries the whole
  position (`start_fen` + UCI moves); games live in the browser.
  - `engine.py`: `EnginePool` of long-lived Stockfish processes (python-chess UCI, async), two
    pools: `play` (Elo-limited) and `analyse` (full strength). A dead engine is respawned.
    Analysis keeps only exact UCI infos from the deepest complete depth (bound infos carry a
    truncated PV; mixing depths duplicates lines).
  - `elo.py`: Elo → UCI options. ≥ 1320: `UCI_LimitStrength`/`UCI_Elo`; below: `Skill Level 0` +
    node budget (uncalibrated).
  - `routers/api.py`: `/api/move`, `/api/analyse`, `/api/health` (pings an engine),
    `/api/version` (engine-free, used by the k8s probes: never point a probe at `/api/health`).
  - `routers/web.py`: `/config.js` (service settings for the front, e.g. default language).
  - `schema/api.py`: Pydantic models; `Position` replays and validates the moves.
  - `schema/settings.py` + `settings.py`: `XAKE_*` environment variables.
  - `webapp.py`: `create_app(settings)`, lifespan starts the pools, static files mounted last.
- **Front-end** (`src/xake/static/`): plain ES modules, **no build, no npm**.
  - `js/main.js`: app controller (rendering, engine/analysis requests, actions, shortcuts).
  - `js/tree.js`: game = tree of moves (first child = main line), bookmarks, undo snapshots.
  - `js/storage.js`: `localStorage`, keys `xake:v1:*`, one key per game.
  - `js/i18n.js`: `en`/`fr` dictionaries, `t()`, `data-i18n*` attributes in `index.html`.
  - `js/share.js`: game ⇄ URL fragment; `js/pgn.js`: PGN export/import (import = main line only).
  - `js/evaluation.js`, `js/timeline.js`, `js/themes.js`, `js/api.js`.
  - `vendor/`: chessground, chess.js and Lichess piece sets, pinned and fetched by
    `scripts/vendor.sh` (`just vendor`) with curl. Never edit by hand.
  - `sw.js`: network-first service worker (app shell offline, API never cached).
- **Deployment**: `Dockerfile` (uv multi-stage, Stockfish from Debian at `/usr/games/stockfish`),
  Helm chart `charts/xake/`, CI `.github/workflows/release.yml` (image `ghcr.io/essembeh/xake`,
  chart published by chart-releaser on tags).

## Commands

The `Justfile` is the project interface:

| Recipe | What |
| --- | --- |
| `just check` | ruff format --check, ruff check, mypy strict on `src` and `tests` |
| `just test` | pytest + coverage, against a **real Stockfish** |
| `just audit` | pip-audit |
| `just chart` | helm lint + template |
| `just webapp` | dev server with reload on `0.0.0.0:8000` |
| `just docker` | build and run the image with podman |
| `just screenshots [url]` | regenerate `docs/screenshots/` (Playwright, browsers from nixpkgs) |
| `just vendor` | refresh pinned front-end assets |
| `just release [bump]` / `just publish` | version bump + chart version + tag, then push |

`check` and `test` are distinct gates, both must pass before a change is ready.

## Environment gotchas

- Stockfish comes from `shell.nix` (direnv: `use nix`). Outside the nix shell, set
  `XAKE_STOCKFISH_PATH`; without a binary the API tests are **skipped**, not failed.
- Tests use the real engine, no mocks: keep assertions robust to engine variance (scores,
  chosen moves, 150 ms timeline judgements differ between runs).
- The front-end has no test suite: check UI changes in a browser (Playwright from nixpkgs, see
  the `screenshots` recipe for the NixOS incantation).

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
