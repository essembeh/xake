#!/bin/sh
# Service settings from the environment, same names and bounds as before (spec 007 §2.3).
set -eu

LANGUAGE=${XAKE_DEFAULT_LANGUAGE:-en}
ELO=${XAKE_DEFAULT_ELO:-1500}
MOVETIME=${XAKE_PLAY_MOVETIME_MS:-300}

fail() { echo "xake: $1" >&2; exit 1; }
case $LANGUAGE in en | fr) ;; *) fail "XAKE_DEFAULT_LANGUAGE must be en or fr, got '$LANGUAGE'" ;; esac
case $ELO in '' | *[!0-9]*) fail "XAKE_DEFAULT_ELO must be a number, got '$ELO'" ;; esac
[ "$ELO" -ge 400 ] && [ "$ELO" -le 3190 ] || fail "XAKE_DEFAULT_ELO must be within 400-3190, got $ELO"
case $MOVETIME in '' | *[!0-9]*) fail "XAKE_PLAY_MOVETIME_MS must be a number, got '$MOVETIME'" ;; esac
[ "$MOVETIME" -ge 10 ] && [ "$MOVETIME" -le 10000 ] || fail "XAKE_PLAY_MOVETIME_MS must be within 10-10000, got $MOVETIME"

mkdir -p /tmp/xake
printf 'window.XAKE_CONFIG = { defaultLanguage: "%s", defaultElo: %s, playMovetimeMs: %s };\n' \
    "$LANGUAGE" "$ELO" "$MOVETIME" > /tmp/xake/config.js
