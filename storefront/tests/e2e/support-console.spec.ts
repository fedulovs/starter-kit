import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { countOwned, platformApi, uniqueKey } from "../support/api.js";
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

/** A delivered order to refund. Setup, not under test, so Iron's random 503s are retried. */
async function deliveredOrder(request: APIRequestContext, gameId: string, offerId: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { body } = await platformApi.order(request, {
      gameId,
      playerId: PLAYER,
      offerId,
      idempotencyKey: uniqueKey("u6"),
    });
    if (body?.status === "delivered") {
      return body;
    }
  }
  throw new Error(`could not get a delivered ${gameId} order to refund`);
}

/** How many of `itemId` the console's inventory panel for `gameId` shows. */
async function shownInConsole(page: Page, gameId: string, itemId: string): Promise<number> {
  const text = await page.getByTestId(`inventory-${gameId}`).locator("pre").textContent();
  try {
    return countOwned(JSON.parse(text ?? "null"), itemId);
  } catch {
    return -1;
  }
}

for (const gameId of ["nova-arena", "iron-siege"]) {
  const { sample } = game(gameId);

  test(title(gameId, "U6", "refunding from the support console removes the item from the game"), async ({ page, request }) => {
    const order = await deliveredOrder(request, gameId, sample.offerId);

    await page.goto("/support.html");
    await page.getByTestId("player-select").selectOption(PLAYER);
    const row = page.getByTestId(`order-${order.orderId}`);
    await expect(row).toBeVisible();

    await expect.poll(() => shownInConsole(page, gameId, sample.itemId)).toBeGreaterThan(0);
    const before = await shownInConsole(page, gameId, sample.itemId);

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
