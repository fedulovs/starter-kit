import { expect, test, type Page } from "@playwright/test";
import { countOwned, orderUntil } from "../support/api.js";
import { game } from "../support/games.js";
import { title } from "../support/tags.js";

/**
 * Support console smoke tests (public/support.html).
 *
 * Agents refund from this page and read the per-game inventory panels to see
 * what a player owns. The docs say nobody has checked it against what really
 * happened; these tests do, for a refund.
 *
 * Nova Arena is the baseline and should pass. Iron Siege has no revoke route,
 * which the platform ignores, so the order says "refunded" and the item stays.
 */

const PLAYER = "p-1002";

/**
 * How many of `itemId` the console's inventory panel for `gameId` shows for
 * PLAYER, or -1 while it shows something else. The page loads the default
 * player on open, and that load can finish after the switch to PLAYER.
 */
async function shownInConsole(page: Page, gameId: string, itemId: string): Promise<number> {
  const text = await page.getByTestId(`inventory-${gameId}`).locator("pre").textContent();
  try {
    const inventory = JSON.parse(text ?? "null");
    return inventory?.playerId === PLAYER ? countOwned(inventory, itemId) : -1;
  } catch {
    return -1;
  }
}

for (const gameId of ["nova-arena", "iron-siege"]) {
  const { sample } = game(gameId);

  test(title(gameId, "U6", "refunding from the support console removes the item from the game"), async ({ page, request }) => {
    // Setup, not under test, so Iron Siege's random failures are retried.
    const order = await orderUntil(
      request,
      { gameId, playerId: PLAYER, offerId: sample.offerId },
      (o) => o?.status === "delivered"
    );

    await page.goto("/support.html");
    await page.getByTestId("player-select").selectOption(PLAYER);
    const row = page.getByTestId(`order-${order.orderId}`);
    await expect(row).toBeVisible();

    let before = -1;
    await expect.poll(async () => (before = await shownInConsole(page, gameId, sample.itemId))).toBeGreaterThan(0);

    await row.getByTestId("refund").click();

    await expect(row.getByTestId("order-status"), "order status after the refund").toHaveText("refunded");
    await expect
      .poll(() => shownInConsole(page, gameId, sample.itemId), {
        message: "items the game still shows after the refund",
        timeout: 10_000,
      })
      .toBe(before - 1);
  });
}
