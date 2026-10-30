# `check` and `test` are two separate gates, mirrored by the CI jobs of the same name.

default:
    @just --list

# Lint, format and typing — like the CI job python-check
check:
    uv run ruff format --check src tests
    uv run ruff check src tests
    uv run mypy src tests

# Unit tests + coverage in the console — like the CI job python-test
test pytest_args="":
    uv run -- pytest --cov=xake --cov-report=term-missing {{pytest_args}}

# Known vulnerabilities in the dependencies actually installed (from uv.lock) — like the CI job python-audit
audit:
    uv run --no-sync -- pip-audit

# Lint and render the Helm chart — like the CI job helm-lint
chart:
    helm lint --strict charts/xake
    helm template xake charts/xake --set ingress.enabled=true --set autoscaling.enabled=true > /dev/null

# Format and fix what can be fixed automatically
format:
    uv run ruff format src tests
    uv run ruff check --fix src tests

# Upgrade uv.lock to the latest allowed releases and the GitHub actions (pinned by SHA)
update-dependencies:
    uv lock --upgrade
    uv sync
    GITHUB_TOKEN=$(gh auth token) uvx gha-update

# Maia opponent assets (~46 MB, not committed, spec 006): downloaded once, checked by SHA-256
maia-assets:
    ./scripts/fetch-maia.sh

# Web app with hot reload, reachable from the LAN (phone testing)
webapp: maia-assets
    uv run -- uvicorn xake.webapp:app --reload --host 0.0.0.0 --port 8000

alias run := webapp

# Build the image locally and run it on port 8000
docker:
    podman build -t xake:local .
    podman run --rm -p 8000:8000 xake:local

# Refresh pinned front-end assets (chessground, chess.js, piece sets)
vendor:
    ./scripts/vendor.sh

# The CI publishes on the tag: `release` creates it, `publish` pushes it
release bump="patch":
    echo "{{bump}}" | grep -E "^(major|minor|patch)$"
    uv version --bump "{{bump}}"
    VERSION=`uv version --short` yq e '.version = strenv(VERSION)'    -i charts/xake/Chart.yaml
    VERSION=`uv version --short` yq e '.appVersion = strenv(VERSION)' -i charts/xake/Chart.yaml
    git add pyproject.toml uv.lock charts/xake/Chart.yaml
    git commit --message "🔖 New release: `uv version --short`"
    git tag "`uv version --short`"

[confirm('Confirm push --tags ?')]
publish:
    git log -1 --pretty="%B" | grep '^🔖 New release: '
    git push
    git push --tags

# Smoke test of the browser engine (Chromium, WebKit) against a running `just webapp`: no CI job, the engine needs a browser
e2e url="http://127.0.0.1:8000/":
    LD_LIBRARY_PATH="$(nix-build '<nixpkgs>' -A stdenv.cc.cc.lib --no-out-link)/lib" \
    PLAYWRIGHT_BROWSERS_PATH="$(nix-build '<nixpkgs>' -A playwright-driver.browsers --no-out-link)" \
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true \
    uv run --script --with "playwright==$(nix-instantiate --eval -E '(import <nixpkgs> {}).python3Packages.playwright.version' | tr -d '"')" \
    scripts/e2e.py --url {{url}}

# Regenerate the README screenshots against a running `just webapp` (NixOS: browsers from nixpkgs)
screenshots url="http://127.0.0.1:8000/":
    LD_LIBRARY_PATH="$(nix-build '<nixpkgs>' -A stdenv.cc.cc.lib --no-out-link)/lib" \
    PLAYWRIGHT_BROWSERS_PATH="$(nix-build '<nixpkgs>' -A playwright-driver.browsers --no-out-link)" \
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true \
    uv run --script --with "playwright==$(nix-instantiate --eval -E '(import <nixpkgs> {}).python3Packages.playwright.version' | tr -d '"')" \
    scripts/screenshots.py --url {{url}}
