#!/bin/sh
# NixOS: Playwright's downloaded browsers do not run, take nixpkgs' ones (same version as
# @playwright/test in package.json). Usage: scripts/nix-playwright.sh npm test
set -eu

nixpkgs() { nix-build '<nixpkgs>' --no-out-link -A "$1"; }
export PLAYWRIGHT_BROWSERS_PATH="$(nixpkgs playwright-driver.browsers)"
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
export LD_LIBRARY_PATH="$(nixpkgs stdenv.cc.cc.lib)/lib"
exec nix-shell -p nodejs_24 --run "$*"
