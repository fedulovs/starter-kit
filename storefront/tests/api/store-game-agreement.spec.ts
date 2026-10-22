import { expect, test, type APIRequestContext } from "@playwright/test";
import { GAMES, game as gameById, type GameUnderTest } from "../support/games.js";
import {
  TRANSIENT_FAILURES,
  gameApi,
  orderUntil,
  ownedInGame,
  platformApi,
  pollUntil,
  retryShedding,
  settledOwned,
  sleep,
  uniqueKey,
} from "../support/api.js";
import { TAG, title } from "../support/tags.js";

/**
 * Store ↔ game agreement: does the platform's record match what the game did?
 *
 * Each test buys or refunds through the platform (:4000) and then asks the
 * game what the player owns. The contract suite shows the games are
 * inconsistent; these tests show whether *our* layer (adapters, retries,
 * refunds, catalogue handling) absorbs that or turns it into lost items,
 * kept refunds and wrong prices.
 *
 * Iron Siege fails at random (8% 503, 10% over 2 s), so its checks run over a
 * batch of orders and assert a rule that must hold for every order, never an
 * exact count. Drift Club is not live, so its orders carry the preview header.
 */

/** A grant from a timed-out attempt can land up to ~3 s after the platform gave up. */
const LATE_GRANT_WAIT_MS = 3_000;
const SLOW_ORDER_MS = 1_800;
const SETTLE = { timeoutMs: 3_000, intervalMs: 200 };

const describe = (body: unknown) => JSON.stringify(body);
const preview = (game: GameUnderTest) => !game.live;

interface PlacedOrder {
  http: number;
  status: string;
  failureReason: string | null;
  /** Items that actually reached the player in the game because of this order. */
  grants: number;
}

/**
 * Places `count` orders one at a time and attributes inventory changes to
 * each, waiting out late grants after a slow or pending order.
 */
async function placeAndAttribute(
  request: APIRequestContext,
  game: GameUnderTest,
  input: { playerId: string; offerId: string; itemId: string },
  count: number
): Promise<PlacedOrder[]> {
  const placed: PlacedOrder[] = [];
  let before = await settledOwned(request, game, input.playerId, input.itemId);
  for (let i = 0; i < count; i++) {
    const res = await platformApi.order(request, {
      gameId: game.gameId,
      playerId: input.playerId,
      offerId: input.offerId,
      preview: preview(game),
    });
    if (res.ms > SLOW_ORDER_MS || res.body?.status === "pending") {
      await sleep(LATE_GRANT_WAIT_MS);
    }
    const after = await ownedInGame(request, game, input.playerId, input.itemId);
    placed.push({
      http: res.status,
      status: res.body?.status ?? `http_${res.status}`,
      failureReason: res.body?.failureReason ?? res.body?.error ?? null,
      grants: after - before,
    });
    before = after;
  }
  return placed;
}

const summary = (orders: PlacedOrder[]) =>
  Object.entries(
    orders.reduce<Record<string, number>>((acc, o) => {
      const key = o.failureReason ? `${o.status} (${o.failureReason})` : o.status;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([key, n]) => `${n} × ${key}`)
    .join(", ");

/** Offers the platform lists, retried while a flaky game makes the list come back empty. */
async function platformOffers(request: APIRequestContext, gameId: string, playerId: string): Promise<any[]> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await platformApi.offers(request, gameId, playerId);
    if (res.body?.offers?.length) {
      return res.body.offers;
    }
  }
  return [];
}

/**
 * I1 needs an order that can be recorded as delivered without the item
 * arriving. Tide Farm's limited-run Golden Tractor (stock of two, the case
 * the handover notes single out) is that case; elsewhere the sample item.
 */
const I1_SCENARIO: Record<string, { playerId: string; offerId: string; itemId: string; orders: number }> = {
  "tide-farm": { playerId: "p-1003", offerId: "golden_tractor", itemId: "GOLDEN_TRACTOR", orders: 3 },
};

for (const game of GAMES) {
  const buyer = game.players[0];
  const { itemId, offerId } = game.sample;

  test.describe(game.displayName, { tag: TAG.invariant }, () => {
    // I1: if the platform says delivered, the player has the item.
    test(title(game.gameId, "I1", "every delivered order put the item in the game"), async ({ request }) => {
      const scenario = I1_SCENARIO[game.gameId] ?? { playerId: buyer, offerId, itemId, orders: 3 };
      const orders = await placeAndAttribute(request, game, scenario, scenario.orders);

      const empty = orders.filter((o) => o.status === "delivered" && o.grants < 1);
      expect(empty.length, `delivered orders with nothing in the game; orders: ${summary(orders)}`).toBe(0);
    });

    // I2 and I3 share one batch of orders; Iron Siege needs many to show its rate.
    test.describe("batch", () => {
      let batch: PlacedOrder[] = [];
      const size = game.gameId === "iron-siege" ? 60 : 5;

      test.beforeAll(async ({ playwright }) => {
        test.setTimeout(300_000);
        const request = await playwright.request.newContext();
        batch = await placeAndAttribute(request, game, { playerId: game.players[1], offerId, itemId }, size);
        await request.dispose();
      });

      // I2: if the platform says the order failed, the player did not get the item.
      test(title(game.gameId, "I2", "no failed order put the item in the game"), async () => {
        const leaked = batch.filter((o) => o.status !== "delivered" && o.status !== "pending" && o.grants > 0);
        expect(
          leaked.map((o) => `${o.status} (${o.failureReason}) but ${o.grants} item(s) arrived`),
          `out of ${batch.length} orders: ${summary(batch)}`
        ).toEqual([]);
      });

      // I3: one delivered order, one item. Retries must not deliver twice.
      test(title(game.gameId, "I3", "items in the game equal delivered orders"), async () => {
        const delivered = batch.filter((o) => o.status === "delivered" || o.status === "pending");
        const items = batch.reduce((sum, o) => sum + o.grants, 0);
        expect(items, `items that reached the game for ${delivered.length} delivered orders (${summary(batch)})`).toBe(
          delivered.length
        );
      });
    });

    // Platform API: "Repeating a request with the same key returns the original
    // order rather than creating a second one."
    test(title(game.gameId, "I4", "repeating an order's idempotency key gives one order and one item"), async ({ request }) => {
      const idempotencyKey = uniqueKey("i4");
      const before = await settledOwned(request, game, buyer, itemId);

      const first = await orderUntil(
        request,
        { gameId: game.gameId, playerId: buyer, offerId, idempotencyKey, preview: preview(game) },
        (order) => Boolean(order?.orderId)
      );
      const second = await platformApi.order(request, {
        gameId: game.gameId,
        playerId: buyer,
        offerId,
        idempotencyKey,
        preview: preview(game),
      });
      await sleep(LATE_GRANT_WAIT_MS);
      const after = await ownedInGame(request, game, buyer, itemId);

      expect.soft(second.body?.orderId, "order returned for the repeated key").toBe(first.orderId);
      const expected = first.status === "delivered" || first.status === "pending" ? 1 : 0;
      expect.soft(after - before, `items in the game for one ${first.status} order sent twice`).toBe(expected);
    });

    // Handover: "A player who has been refunded must not keep the item."
    test(title(game.gameId, "I5", "a refunded order's item is removed from the game"), async ({ request }) => {
      const before = await settledOwned(request, game, buyer, itemId);
      const order = await orderUntil(
        request,
        { gameId: game.gameId, playerId: buyer, offerId, preview: preview(game) },
        (o) => o?.status === "delivered" || o?.status === "pending"
      );
      const owned = await pollUntil(() => ownedInGame(request, game, buyer, itemId), (n) => n > before, SETTLE);

      const refund = await platformApi.refund(request, order.orderId);
      const after = await pollUntil(() => ownedInGame(request, game, buyer, itemId), (n) => n < owned, SETTLE);

      expect.soft(refund.status, `refund answer ${describe(refund.body)}`).toBe(200);
      expect.soft(refund.body?.status, "order status after refund").toBe("refunded");
      expect.soft(owned - after, "items removed from the game by the refund").toBe(1);
    });

    // Offers are "normalised across games": same price, same currency the game states.
    test(title(game.gameId, "I7", "offer prices and currency match the game's catalogue"), async ({ request }) => {
      const catalog = await retryShedding(() => gameApi.catalog(request, game, buyer));
      const offers = await platformOffers(request, game.gameId, buyer);
      expect(offers.length, "platform offers").toBeGreaterThan(0);

      for (const item of catalog.body?.items ?? []) {
        const offer = offers.find((o: any) => o.gameItemId === item.itemId);
        const label = `${JSON.stringify(item.itemId)} (game: ${describe(item)})`;
        expect.soft(offer, `${label}: listed by the platform`).toBeTruthy();
        if (!offer) continue;

        const gamePriceMinor = Number.isInteger(item.priceMinor)
          ? item.priceMinor
          : Math.round(Number(item.price) * 100);
        expect.soft(offer.priceMinor, `${label}: price in minor units`).toBe(gamePriceMinor);
        expect.soft(
          offer.currency ?? null,
          `${label}: currency${item.currency ? "" : " (the game states none; the platform must not assume one)"}`
        ).toBe(item.currency ?? null);
      }
    });

    // Contract: "the store never shows an offer that cannot be delivered."
    // The platform passes Tide Farm's unfiltered catalogue straight through.
    test(title(game.gameId, "I8", "every offer the platform lists can be bought"), async ({ request }) => {
      test.setTimeout(180_000);
      const refused: string[] = [];

      for (const playerId of game.players) {
        for (const offer of await platformOffers(request, game.gameId, playerId)) {
          let res = await platformApi.order(request, {
            gameId: game.gameId,
            playerId,
            offerId: offer.offerId,
            preview: preview(game),
          });
          for (let retry = 0; retry < 4; retry++) {
            const transient =
              TRANSIENT_FAILURES.includes(res.body?.failureReason) || res.body?.error === "offer_not_found";
            if (!transient) break;
            res = await platformApi.order(request, {
              gameId: game.gameId,
              playerId,
              offerId: offer.offerId,
              preview: preview(game),
            });
          }
          if (res.body?.status !== "delivered" && res.body?.status !== "pending") {
            refused.push(`${playerId} ${offer.offerId} → ${res.body?.status ?? res.status} (${res.body?.failureReason ?? res.body?.error})`);
          }
        }
      }

      expect(refused, "listed for the player, then not deliverable").toEqual([]);
    });

    // PS-318: a game that is failing must not look like an empty shop.
    test(title(game.gameId, "I9", "a failing game is reported as an error, not an empty shop"), async ({ request }) => {
      const samples = 30;
      let silentlyEmpty = 0;
      for (let i = 0; i < samples; i++) {
        const res = await platformApi.offers(request, game.gameId, buyer);
        if (res.status === 200 && (res.body?.offers ?? []).length === 0) {
          silentlyEmpty++;
        }
      }
      expect(silentlyEmpty, `offer lists answered 200 with no offers, out of ${samples}`).toBe(0);
    });

    // Platform API: status is pending, delivered, failed or refunded.
    // An order the game has settled must not stay pending.
    test(title(game.gameId, "I10", "an order reaches a final status once the game has settled it"), async ({ request }) => {
      const before = await settledOwned(request, game, buyer, itemId);
      const order = await orderUntil(
        request,
        { gameId: game.gameId, playerId: buyer, offerId, preview: preview(game) },
        (o) => o?.status === "delivered" || o?.status === "pending"
      );
      await pollUntil(() => ownedInGame(request, game, buyer, itemId), (n) => n > before, SETTLE);
      const settled = await pollUntil(
        async () => (await platformApi.getOrder(request, order.orderId)).body,
        (o) => o?.status !== "pending",
        { timeoutMs: 5_000, intervalMs: 250 }
      );

      expect(settled?.status, "order status 5 s after the game delivered the item").toBe("delivered");
    });
  });
}

// Platform API: "Refunds the order and asks the game to revoke the grant."
// Only something that was delivered can be refunded, and only once.
test(title("platform", "I6", "only delivered orders can be refunded, and only once"), { tag: TAG.invariant }, async ({ request }) => {
  const tide = gameById("tide-farm");
  const nova = gameById("nova-arena");

  // Harvest Pass needs level 10; Bo is level 3, so this order fails.
  const failed = await orderUntil(
    request,
    { gameId: tide.gameId, playerId: "p-1002", offerId: "harvest_pass" },
    (o) => o?.status === "failed"
  );
  const refundFailed = await platformApi.refund(request, failed.orderId);
  expect.soft(
    refundFailed.status,
    `refunding a failed order (grantId ${failed.grantId}): ${describe(refundFailed.body)}`
  ).toBeGreaterThanOrEqual(400);

  const delivered = await orderUntil(
    request,
    { gameId: nova.gameId, playerId: "p-1001", offerId: nova.sample.offerId },
    (o) => o?.status === "delivered"
  );
  const first = await platformApi.refund(request, delivered.orderId);
  const second = await platformApi.refund(request, delivered.orderId);
  expect.soft(first.status, "first refund of a delivered order").toBe(200);
  expect.soft(second.status, `second refund of the same order: ${describe(second.body)}`).toBeGreaterThanOrEqual(400);
});
