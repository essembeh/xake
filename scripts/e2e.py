#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["playwright"]
# ///
"""Smoke test of the browser engine against a running Xake (`just webapp`), see `just e2e`.

The engine lives in the front-end, which has no unit tests (spec 005 §11): Chromium and WebKit
play a move against Stockfish, show the best moves, and cache the engine for the offline launch.
"""

import argparse
import sys

from playwright.sync_api import Page, sync_playwright

ENGINE_FILES = ("stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm")


def click_square(page: Page, square: str) -> None:
    box = page.locator("cg-board").bounding_box()
    assert box is not None
    size = box["width"] / 8
    file, rank = "abcdefgh".index(square[0]), int(square[1])
    page.mouse.click(box["x"] + (file + 0.5) * size, box["y"] + (8 - rank + 0.5) * size)


def check(page: Page, base: str) -> list[str]:
    out: list[str] = []
    page.on("pageerror", lambda error: out.append(f"page error: {error}"))
    page.on("request", lambda request: "/api/" in request.url and out.append(f"server call: {request.url}"))
    page.goto(base, wait_until="networkidle")
    # A fresh game, White, best moves shown
    page.goto(f"{base}#c=w&e=1500&m=", wait_until="networkidle")
    page.wait_for_function("document.querySelector('.evalbar-label')?.textContent", timeout=30_000)
    click_square(page, "e2")
    click_square(page, "e4")
    try:
        page.wait_for_function("document.querySelectorAll('#moves .mv').length >= 2", timeout=20_000)
    except Exception:
        out.append("no engine reply to 1.e4")
    if page.get_attribute("#btn-best", "aria-pressed") != "true":
        page.click("#btn-best")
    try:
        page.wait_for_selector("#lines button.line", timeout=20_000)
    except Exception:
        out.append("no best moves shown")
    page.wait_for_timeout(1500)
    keys = page.evaluate(
        "async () => (await (await caches.open('xake-shell')).keys()).map((r) => new URL(r.url).pathname)"
    )
    out += [f"not cached for offline: {name}" for name in ENGINE_FILES if not any(k.endswith(name) for k in keys)]
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000/")
    args = parser.parse_args()
    failures = 0
    with sync_playwright() as pw:
        # Firefox is left out: Playwright's build runs WebAssembly ~12x slower than a real Firefox
        for kind in ("chromium", "webkit"):
            browser = getattr(pw, kind).launch()
            problems = check(browser.new_page(viewport={"width": 1280, "height": 900}), args.url)
            browser.close()
            print(f"{kind}: {'ok' if not problems else ', '.join(problems)}")
            failures += len(problems)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
