#!/usr/bin/env bash
# Fetch pinned front-end assets into src/xake/static/vendor (no Node toolchain, see spec §8).
set -euo pipefail

CHESSGROUND_VERSION=9.2.1
CHESSJS_VERSION=1.4.0
STOCKFISH_VERSION=19.0.1
LILA_REF=master
PIECE_SETS=(cburnett merida mpchess pixel)

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VENDOR=$ROOT/src/xake/static/vendor
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Only what this script manages: the Maia assets (scripts/fetch-maia.sh, not committed) stay
rm -rf "$VENDOR/chessground" "$VENDOR/chess.js" "$VENDOR/pieces" "$VENDOR/stockfish"
mkdir -p "$VENDOR/chessground" "$VENDOR/chess.js" "$VENDOR/pieces" "$VENDOR/stockfish"

curl -fsSL "https://registry.npmjs.org/chessground/-/chessground-$CHESSGROUND_VERSION.tgz" | tar xz -C "$TMP"
cp "$TMP/package/dist/chessground.min.js" "$TMP/package/assets/chessground.base.css" "$TMP/package/LICENSE" \
    "$VENDOR/chessground/"
rm -rf "$TMP/package"

curl -fsSL "https://registry.npmjs.org/chess.js/-/chess.js-$CHESSJS_VERSION.tgz" | tar xz -C "$TMP"
cp "$TMP/package/dist/esm/chess.js" "$TMP/package/LICENSE" "$VENDOR/chess.js/"
rm -rf "$TMP/package"

# Browser engine, lite single-threaded flavour only (spec 005 §2)
curl -fsSL "https://registry.npmjs.org/stockfish/-/stockfish-$STOCKFISH_VERSION.tgz" | tar xz -C "$TMP"
cp "$TMP/package/bin/stockfish-19-lite-single.js" "$TMP/package/bin/stockfish-19-lite-single.wasm" \
    "$TMP/package/Copying.txt" "$VENDOR/stockfish/"

for set in "${PIECE_SETS[@]}"; do
    mkdir -p "$VENDOR/pieces/$set"
    for color in w b; do
        for role in P N B R Q K; do
            curl -fsSL -o "$VENDOR/pieces/$set/$color$role.svg" \
                "https://raw.githubusercontent.com/lichess-org/lila/$LILA_REF/public/piece/$set/$color$role.svg"
        done
    done
done
curl -fsSL -o "$VENDOR/pieces/COPYING.md" "https://raw.githubusercontent.com/lichess-org/lila/$LILA_REF/COPYING.md"

echo "chessground $CHESSGROUND_VERSION, chess.js $CHESSJS_VERSION, stockfish.js $STOCKFISH_VERSION, pieces: ${PIECE_SETS[*]}" \
    > "$VENDOR/VERSIONS"
