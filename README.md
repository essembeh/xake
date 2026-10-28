[![Build & Tests](https://github.com/essembeh/xake/actions/workflows/release.yml/badge.svg)](https://github.com/essembeh/xake/actions/workflows/release.yml)

# Xake

> **TL;DR** Play Stockfish at the Elo you choose, peek at the best moves when you want, and
> replay your games with an evaluation graph that points at your mistakes. Runs in the browser,
> installs on a phone home screen, stores nothing on the server.

_Xake_ means "chess" in Basque.

![Desktop: best moves on demand, numbered arrows, variations and bookmarks](docs/screenshots/desktop-best-moves.png)

## Features

- **Opponent at any level**: Stockfish from 400 to 3190 Elo, adjustable at any time during a game.
- **Best moves on demand** (`B`): up to 5 Stockfish lines, numbered and colour-coded arrows on the
  board, the same numbers in the list; tap a line to play it.
- **Evaluation bar** next to the board and an **evaluation graph** of the whole game (`A`), with
  inaccuracies `?!`, mistakes `?` and blunders `??` marked on the graph and in the move list.
- **Variations**: go back anywhere and play another move, nothing is lost; the move list shows the
  variations under the move they replace.
- **Bookmarks** (`M`) to jump back to a position and try another idea.
- **Take back** (`U`) with redo, **swap sides with Stockfish** (`C`) or **play both sides** (`T`)
  to force the opponent move and study a precise position.
- **Saved games** in the browser, **PGN** export / import, and **shareable links**: the whole game,
  variations included, fits in the URL.
- **Keyboard shortcuts** for everything (`?` lists them).
- **Themes**: light / dark / auto, 6 boards, 4 piece sets, all under free licences; **English and French**.
- **Mobile first**: touch friendly layout, installable on the iOS / Android home screen (PWA).

| Evaluation graph | Game over |
| --- | --- |
| ![Evaluation graph with annotated mistakes](docs/screenshots/desktop-timeline.png) | ![Game over card](docs/screenshots/desktop-game-over.png) |

| Mobile, dark theme | Settings | In French |
| --- | --- | --- |
| ![Mobile dark theme with best moves](docs/screenshots/mobile-dark.png) | ![Settings sheet](docs/screenshots/mobile-settings.png) | ![French interface](docs/screenshots/mobile-french.png) |

## How it works

The backend is a stateless [FastAPI](https://fastapi.tiangolo.com/) service driving a pool of
[Stockfish](https://stockfishchess.org/) processes through
[python-chess](https://python-chess.readthedocs.io/). Each request carries the whole position, the
games live in the browser (`localStorage`). The front-end is plain JavaScript modules without any
build step, with [chessground](https://github.com/lichess-org/chessground) (the Lichess board) and
[chess.js](https://github.com/jhlywa/chess.js).

- The opponent plays with `UCI_LimitStrength` / `UCI_Elo` (1320+), a node-starved engine below.
  The Elo is indicative: Stockfish calibrates it on long games.
- Best moves and the evaluation bar come from Stockfish at full strength, 500 ms per position;
  the evaluation graph uses 150 ms per position.

Design notes live in [`docs/specs`](docs/specs).

# Install

## Helm

```sh
$ helm repo add xake https://essembeh.github.io/xake/
$ helm install xake xake/xake --set xake.defaultLanguage=en
```

Values and sizing (each Stockfish process holds ~330 MiB) are documented in the
[chart README](charts/xake/README.md). The API has no authentication: put an auth in front of
the ingress if it is reachable from the Internet. Serve it over HTTPS, the service worker needs it.

## Docker

```sh
$ docker run --rm -p 8000:8000 ghcr.io/essembeh/xake:main
```

Then open http://localhost:8000/. The image ships Stockfish from Debian.

## From source

```sh
$ git clone https://github.com/essembeh/xake
$ cd xake
$ nix-shell     # or install uv, just and stockfish yourself
$ uv sync
$ just webapp   # http://localhost:8000, also reachable from your LAN
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `XAKE_DEFAULT_LANGUAGE` | `en` | UI language (`en`, `fr`) until a user picks one in the settings |
| `XAKE_STOCKFISH_PATH` | `stockfish` | Stockfish binary (`/usr/games/stockfish` in the image) |
| `XAKE_PLAY_POOL_SIZE` | `1` | Stockfish processes playing the opponent moves |
| `XAKE_ANALYSE_POOL_SIZE` | `2` | Stockfish processes for best moves, evaluation bar and graph |
| `XAKE_ENGINE_THREADS` | `1` | Threads per Stockfish process |
| `XAKE_ENGINE_HASH_MB` | `64` | Hash table per Stockfish process |
| `XAKE_PLAY_MOVETIME_MS` | `300` | Thinking time of the opponent |
| `XAKE_ANALYSE_MOVETIME_MS` | `500` | Analysis time per position |
| `XAKE_MAX_MOVETIME_MS` | `3000` | Upper bound on any time asked by a client |
| `XAKE_ACQUIRE_TIMEOUT_S` | `10` | Wait for a free engine before answering `503` |

# Development

```sh
$ just check        # ruff format + ruff check + mypy (CI: python-check)
$ just test         # pytest against a real Stockfish (CI: python-test)
$ just chart        # helm lint + template (CI: helm-lint)
$ just docker       # build and run the image with podman
$ just screenshots  # regenerate the README screenshots from a running `just webapp`
$ just vendor       # refresh the pinned front-end libraries and piece sets
```

# License

Xake is released under the [GPL-3.0-or-later](LICENSE), like chessground and Stockfish.
The piece sets come from [Lichess](https://github.com/lichess-org/lila) and are all free:
`cburnett` and `merida` GPLv2+, `mpchess` GPLv3+, `pixel` AGPLv3+, see
[`COPYING.md`](src/xake/static/vendor/pieces/COPYING.md). The boards are plain CSS colours.
