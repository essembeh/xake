// Capture the README screenshots from a running Xake: `npm run screenshots [-- <url>]` (default: the dev server).
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] || "http://localhost:8000/";
const OUT = "docs/screenshots";
// Ruy Lopez with a variation on move 1, then a quiet middlegame
const OPENING = "e2e4.e7e5.(c7c5.g1f3.d7d6).g1f3.b8c6.f1b5.a7a6.b5a4.g8f6.e1g1.f8e7.f1e1.b7b5.a4b3.d7d6.c2c3.e8g8";
// Black blunders the queen, then White misses mate and the game goes on
const BLUNDERS = "e2e4.e7e5.g1f3.b8c6.f1c4.g8f6.f3g5.d7d5.e4d5.f6d5.g5f7.e8f7.d1f3.f7e6.b1c3.c6b4.f3e4.c7c6.d2d4";
const SCHOLAR = "e2e4.e7e5.f1c4.b8c6.d1h5.g8f6.h5f7";

const timelineDone = () => !document.querySelector("#timeline-progress")?.textContent;

async function openGame(page, moves, color = "w", elo = 1500) {
  // A full load: a same-document hash change would keep the preferences of the previous load
  await page.goto("about:blank");
  await page.goto(`${BASE}#c=${color}&e=${elo}&m=${moves}`, { waitUntil: "networkidle" });
  await page.waitForFunction(timelineDone, null, { timeout: 60_000 });
  // Let the toast fade and the board animation settle
  await page.waitForTimeout(4500);
}

async function showBestMoves(page) {
  if ((await page.getAttribute("#btn-best", "aria-pressed")) !== "true") await page.keyboard.press("b");
  await page.waitForSelector("#lines button.line", { timeout: 20_000 });
  await page.waitForTimeout(300);
}

async function setPrefs(page, prefs) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate((p) => {
    const key = "xake:v1:prefs";
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || "{}"), ...p }));
  }, prefs);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

const desktop = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5 });
let page = await desktop.newPage();
await setPrefs(page, { uiTheme: "light", boardTheme: "brown", pieceSet: "cburnett", language: "en" });
await openGame(page, OPENING);
await showBestMoves(page);
await page.click("#btn-bookmark");
await page.waitForTimeout(4500);
await page.screenshot({ path: `${OUT}/desktop-best-moves.png` });

await page.keyboard.press("b");
await openGame(page, BLUNDERS);
await page.keyboard.press("r");
await page.waitForFunction(timelineDone, null, { timeout: 60_000 });
// The quick timeline evals vary between runs: jump to the first flagged move
await page.locator(".tl-dot.blunder, .tl-dot.mistake, .tl-dot.inaccuracy").first().click();
await page.waitForSelector("#lines button.line", { timeout: 20_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/desktop-timeline.png` });
await page.keyboard.press("r");

await openGame(page, SCHOLAR, "b");
await page.screenshot({ path: `${OUT}/desktop-game-over.png` });
await desktop.close();

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
page = await mobile.newPage();
await setPrefs(page, { uiTheme: "dark", boardTheme: "blue", pieceSet: "pixel", language: "en" });
await openGame(page, OPENING);
await showBestMoves(page);
await page.screenshot({ path: `${OUT}/mobile-dark.png` });

await page.click("#btn-settings");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/mobile-settings.png` });
await page.click("#sheet-settings [data-close]");

await setPrefs(page, { uiTheme: "light", boardTheme: "green", pieceSet: "mpchess", language: "fr" });
await openGame(page, OPENING);
await page.screenshot({ path: `${OUT}/mobile-french.png` });
await mobile.close();

await browser.close();
console.log(`Screenshots written to ${OUT}/`);
