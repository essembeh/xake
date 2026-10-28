#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["playwright"]
# ///
"""Capture the README screenshots from a running Xake (`just webapp`), see `just screenshots`."""

import argparse
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

# Ruy Lopez with a variation on move 1, then a quiet middlegame
OPENING = "e2e4.e7e5.(c7c5.g1f3.d7d6).g1f3.b8c6.f1b5.a7a6.b5a4.g8f6.e1g1.f8e7.f1e1.b7b5.a4b3.d7d6.c2c3.e8g8"
# Black blunders the queen, then White misses mate and the game goes on
BLUNDERS = "e2e4.e7e5.g1f3.b8c6.f1c4.g8f6.f3g5.d7d5.e4d5.f6d5.g5f7.e8f7.d1f3.f7e6.b1c3.c6b4.f3e4.c7c6.d2d4"
SCHOLAR = "e2e4.e7e5.f1c4.b8c6.d1h5.g8f6.h5f7"


def open_game(page: Page, base: str, moves: str, color: str = "w", elo: int = 1500) -> None:
    # A full load: a same-document hash change would keep the preferences of the previous load
    page.goto("about:blank")
    page.goto(f"{base}#c={color}&e={elo}&m={moves}", wait_until="networkidle")
    page.wait_for_function("!document.querySelector('#timeline-progress')?.textContent", timeout=60_000)
    # Let the toast fade and the board animation settle
    page.wait_for_timeout(4500)


def show_best_moves(page: Page) -> None:
    if page.get_attribute("#btn-best", "aria-pressed") != "true":
        page.keyboard.press("b")
    page.wait_for_selector("#lines button.line", timeout=20_000)
    page.wait_for_timeout(300)


def set_prefs(page: Page, base: str, **prefs: object) -> None:
    page.goto(base, wait_until="networkidle")
    page.evaluate(
        "p => { const k = 'xake:v1:prefs'; localStorage.setItem(k, JSON.stringify({...JSON.parse(localStorage.getItem(k) || '{}'), ...p})); }",
        prefs,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000/")
    parser.add_argument("--out", type=Path, default=Path("docs/screenshots"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        desktop = browser.new_context(viewport={"width": 1440, "height": 860}, device_scale_factor=1.5)
        page = desktop.new_page()
        set_prefs(page, args.url, uiTheme="light", boardTheme="brown", pieceSet="cburnett", language="en")
        open_game(page, args.url, OPENING)
        show_best_moves(page)
        page.click("#btn-bookmark")
        page.wait_for_timeout(4500)
        page.screenshot(path=args.out / "desktop-best-moves.png")

        page.keyboard.press("b")
        open_game(page, args.url, BLUNDERS)
        page.keyboard.press("r")
        page.wait_for_function("!document.querySelector('#timeline-progress').textContent", timeout=60_000)
        # The quick timeline evals vary between runs: jump to the first flagged move
        page.locator(".tl-dot.blunder, .tl-dot.mistake, .tl-dot.inaccuracy").first.click()
        page.wait_for_selector("#lines button.line", timeout=20_000)
        page.wait_for_timeout(800)
        page.screenshot(path=args.out / "desktop-timeline.png")
        page.keyboard.press("r")

        open_game(page, args.url, SCHOLAR, color="b")
        page.screenshot(path=args.out / "desktop-game-over.png")
        desktop.close()

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True)
        page = mobile.new_page()
        set_prefs(page, args.url, uiTheme="dark", boardTheme="blue", pieceSet="pixel", language="en")
        open_game(page, args.url, OPENING)
        show_best_moves(page)
        page.screenshot(path=args.out / "mobile-dark.png")

        page.click("#btn-settings")
        page.wait_for_timeout(500)
        page.screenshot(path=args.out / "mobile-settings.png")
        page.click("#sheet-settings [data-close]")

        set_prefs(page, args.url, uiTheme="light", boardTheme="green", pieceSet="mpchess", language="fr")
        open_game(page, args.url, OPENING)
        page.screenshot(path=args.out / "mobile-french.png")
        mobile.close()

        browser.close()
    for path in sorted(args.out.glob("*.png")):
        print(path)


if __name__ == "__main__":
    main()
