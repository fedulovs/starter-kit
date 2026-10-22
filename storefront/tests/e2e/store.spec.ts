import { expect, test } from "@playwright/test";
import { platformApi } from "../support/api.js";
import { DECLINED_CARD, buy, openStore, orderRow, pay, startCheckout, storeGames, storeOrders } from "../support/store.js";
import { TAG, title } from "../support/tags.js";

/**
 * Store smoke tests: what a player sees and gets when they buy.
 *
 * U1, U2 and U5 are baselines and should pass; they prove the harness drives
 * the real flow, so a red U3/U4/U7 means the store misbehaves, not the test.
 * Flows use Nova Arena or Tide Farm, whose behaviour is deterministic; Iron
 * Siege's random failures are covered in the api suite, not here.
 */

const EURO_PRICE = /^€\d+\.\d{2}$/;

test(title("store", "U1", "the store lists the live games and their priced offers"), async ({ page, request }) => {
  const { body } = await platformApi.games(request);
  const shown = await storeGames(request);
  const preview = shown.some((game: any) => !game.live);
  const expected = body.games.filter((game: any) => preview || game.live).map((game: any) => game.gameId);

  await openStore(page, "p-1001", "nova-arena");

  const tabs = page.getByTestId("game-tabs").getByRole("button");
  await expect(tabs).toHaveCount(expected.length);
  for (const gameId of expected) {
    await expect(page.getByTestId(`game-${gameId}`)).toBeVisible();
  }

  const prices = page.getByTestId("offers").getByTestId("offer-price");
  await expect(prices.first()).toBeVisible();
  for (const price of await prices.allTextContents()) {
    expect(price, "Nova Arena offer price").toMatch(EURO_PRICE);
  }
});

test(title("nova-arena", "U2", "buying an item shows the order as delivered"), async ({ page }) => {
  await openStore(page, "p-1001", "nova-arena");

  const checkout = await buy(page, "gems_small");

  expect(checkout.status, `checkout answer ${JSON.stringify(checkout.body)}`).toBe(201);
  await expect(page.getByTestId("checkout")).toBeHidden();
  await expect(orderRow(page, checkout.body.orderId).getByTestId("order-status")).toHaveText("Delivered");
});

// PS-330. Harvest Pass needs level 10; Bo is level 3. Tide Farm still lists it,
// refuses it at delivery, and the platform records the order as failed.
test(title("tide-farm", "U3", "an order that was not delivered is not shown as Delivered"), async ({ page }) => {
  await openStore(page, "p-1002", "tide-farm");

  const checkout = await buy(page, "harvest_pass");
  const order = await page.request.get(`/api/orders/${checkout.body.orderId}`).then((r) => r.json());

  expect(order.status, "the platform's own record of the order").toBe("failed");
  await expect(
    orderRow(page, checkout.body.orderId).getByTestId("order-status"),
    "label shown to the player for a failed order"
  ).not.toHaveText("Delivered");
});

// PS-341. A slow purchase invites a second click; it must not become a second order.
test(title("nova-arena", "U4", "double-clicking Pay places a single order"), async ({ page, request }) => {
  const playerId = "p-1003";
  await openStore(page, playerId, "nova-arena");
  const before = (await storeOrders(request, playerId)).length;

  await startCheckout(page, "gems_small");
  await page.getByTestId("checkout-pay").dblclick();
  await expect(page.getByTestId("checkout")).toBeHidden();

  await expect
    .poll(async () => (await storeOrders(request, playerId)).length, { timeout: 5_000 })
    .toBeGreaterThan(before);
  await page.waitForTimeout(1_000);
  const after = (await storeOrders(request, playerId)).length;

  expect(after - before, "orders created by one double-click").toBe(1);
});

test(title("nova-arena", "U5", "a declined card shows an error and creates no order"), async ({ page, request }) => {
  const playerId = "p-1001";
  await openStore(page, playerId, "nova-arena");
  const before = (await storeOrders(request, playerId)).length;

  await startCheckout(page, "gems_small", DECLINED_CARD);
  const checkout = await pay(page);

  expect(checkout.status, "checkout answer for a declined card").toBe(402);
  await expect(page.getByTestId("checkout-error")).toContainText("card_declined");
  await expect(page.getByTestId("checkout")).toBeVisible();
  expect((await storeOrders(request, playerId)).length, "orders after a declined payment").toBe(before);
});

// Handover notes: Drift Club's economy is denominated in USD. The platform
// reports no currency for it, and the store renders every price in euros.
test(
  title("drift-club", "U7", "prices are shown in the game's currency, not always euros"),
  { tag: TAG.preview },
  async ({ page, request }) => {
    const shown = await storeGames(request);
    test.skip(
      !shown.some((game: any) => game.gameId === "drift-club"),
      "needs the storefront started with PREVIEW_GAMES=true"
    );

    await openStore(page, "p-1001", "drift-club");

    const prices = await page.getByTestId("offers").getByTestId("offer-price").allTextContents();
    expect(prices.length, "Drift Club offers").toBeGreaterThan(0);
    for (const price of prices) {
      expect(price, "Drift Club price as shown to the player").not.toContain("€");
    }
  }
);
