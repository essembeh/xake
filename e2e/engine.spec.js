// The engines live in the front-end, which has no unit tests (spec 005 §11): Stockfish replies and
// shows the best moves, its files are cached for the offline launch, then Maia plays (spec 006).
import { expect, test } from "@playwright/test";

const ENGINE_FILES = ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"];

async function clickSquare(page, square) {
  const box = await page.locator("cg-board").boundingBox();
  const size = box.width / 8;
  const file = "abcdefgh".indexOf(square[0]);
  const rank = Number(square[1]);
  await page.mouse.click(box.x + (file + 0.5) * size, box.y + (8 - rank + 0.5) * size);
}

let errors;
test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test("Stockfish replies, shows the best moves and is cached for offline", async ({ page }) => {
  await page.goto("./");
  await page.goto("./#c=w&e=1500&m=");
  await expect(page.locator(".evalbar-label")).not.toBeEmpty({ timeout: 30_000 });
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(page.locator("#moves .mv")).toHaveCount(2, { timeout: 20_000 });

  if ((await page.getAttribute("#btn-best", "aria-pressed")) !== "true") await page.click("#btn-best");
  await expect(page.locator("#lines button.line").first()).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(() =>
      page.evaluate(async () => (await (await caches.open("xake-shell")).keys()).map((r) => new URL(r.url).pathname)),
    )
    .toEqual(expect.arrayContaining(ENGINE_FILES.map((name) => expect.stringContaining(name))));
});

test("Maia plays the first move", async ({ page }) => {
  await page.goto("./");
  await page.click("#btn-new");
  await page.click("#color-input button[data-value=black]");
  await page.click("#opponent-input button:nth-child(2)");
  await page.click("#new-start");
  await expect(page.locator("#sheet-new")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#moves .mv")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator("#strip-top .name")).toHaveText("Maia");
});
