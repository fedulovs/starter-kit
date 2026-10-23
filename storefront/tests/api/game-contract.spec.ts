import { expect, test, type APIRequestContext } from "@playwright/test";
import { GAMES, type GameUnderTest } from "../support/games.js";
import {
  gameApi,
  ownedInGame,
  pollUntil,
  retryShedding,
  settledOwned,
  sleep,
  uniqueKey,
} from "../support/api.js";
import { TAG, title } from "../support/tags.js";

/**
 * Game Integration API v1 contract, checked against every game directly.
 *
 * Each test is one rule from docs/game-integration-api.md (quoted in the
 * comment above it), run once per game. A red test here means the game does
 * not do what the platform team's own contract says; it is not an opinion.
 *
 * Side effects: grants land in the games' in-memory inventories (C6 also
 * spends one Golden Tractor out of Tide Farm's stock of two). Tests measure
 * before/after differences, so earlier runs do not change the verdicts.
 */

const ITEM_ID_FORMAT = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const CURRENCY_FORMAT = /^[A-Z]{3}$/;
const TIMEOUT_MS = 2_000;

/** Queue-backed games may take a moment to show a grant; give them a fair chance. */
const SETTLE = { timeoutMs: 3_000, intervalMs: 200 };

const isSuccess = (status: number) => status >= 200 && status < 300;
const describe = (body: unknown) => JSON.stringify(body);

for (const game of GAMES) {
  const player = game.players[0];
  const item = game.sample.itemId;

  const owned = (request: APIRequestContext) => ownedInGame(request, game, player, item);
  const baseline = (request: APIRequestContext) => settledOwned(request, game, player, item);

  test.describe(game.displayName, { tag: TAG.contract }, () => {
    // "GET /game/v1/health → { "status": "ok" }"
    test(title(game.gameId, "C1", "health reports ok"), async ({ request }) => {
      const res = await retryShedding(() => gameApi.health(request, game));

      expect(res.status, "health status").toBe(200);
      expect(res.body?.status, `health body ${describe(res.body)}`).toBe("ok");
    });

    // "GET /game/v1/players/{playerId} → { playerId, displayName, level }"
    test(title(game.gameId, "C2", "known players are returned with id, name and level"), async ({ request }) => {
      for (const playerId of game.players) {
        const res = await retryShedding(() => gameApi.player(request, game, playerId));
        const body = res.body;

        expect.soft(res.status, `${playerId}: status`).toBe(200);
        expect.soft(body?.playerId, `${playerId}: playerId in ${describe(body)}`).toBe(playerId);
        expect.soft(typeof body?.displayName, `${playerId}: displayName in ${describe(body)}`).toBe("string");
        expect.soft(Number.isInteger(body?.level), `${playerId}: integer level in ${describe(body)}`).toBe(true);
      }
    });

    // "Returns 404 with an error body when the game has no such player."
    test(title(game.gameId, "C3", "unknown player returns 404 with an error body"), async ({ request }) => {
      const res = await retryShedding(() => gameApi.player(request, game, game.unknownPlayer));

      expect.soft(res.status, `status for unknown player, body ${describe(res.body)}`).toBe(404);
      expect.soft(typeof res.body?.error, `error code in ${describe(res.body)}`).toBe("string");
    });

    // "Prices are integer minor units in priceMinor, with an ISO 4217 code in currency."
    test(title(game.gameId, "C4", "catalog prices are integer minor units with an ISO currency"), async ({ request }) => {
      const res = await retryShedding(() => gameApi.catalog(request, game, player));
      const items: any[] = res.body?.items ?? [];

      expect(res.status, "catalog status").toBe(200);
      expect(items.length, `catalog items in ${describe(res.body)}`).toBeGreaterThan(0);
      for (const entry of items) {
        const label = `item ${describe(entry)}`;
        expect.soft(typeof entry.name, `${label}: name`).toBe("string");
        expect.soft(Number.isInteger(entry.priceMinor) && entry.priceMinor > 0, `${label}: positive integer priceMinor`).toBe(true);
        expect.soft(String(entry.currency ?? ""), `${label}: ISO 4217 currency`).toMatch(CURRENCY_FORMAT);
      }
    });

    // "Item identifiers are lowercase, snake_case, and stable for the lifetime of the integration."
    test(title(game.gameId, "C5", "item ids are lowercase snake_case"), async ({ request }) => {
      const res = await retryShedding(() => gameApi.catalog(request, game, player));
      const ids = (res.body?.items ?? []).map((entry: any) => entry.itemId);

      expect(ids.length, `catalog items in ${describe(res.body)}`).toBeGreaterThan(0);
      const offending = ids.filter((id: unknown) => typeof id !== "string" || !ITEM_ID_FORMAT.test(id));
      expect(offending.map((id: unknown) => JSON.stringify(id)), "item ids not in lowercase snake_case").toEqual([]);
    });

    // "Games are expected to filter out anything the player is not eligible for,
    //  so that the store never shows an offer that cannot be delivered."
    test(title(game.gameId, "C6", "every catalog item can be delivered to that player"), async ({ request }) => {
      const undeliverable: string[] = [];

      for (const playerId of game.players) {
        const catalog = await retryShedding(() => gameApi.catalog(request, game, playerId));
        for (const entry of catalog.body?.items ?? []) {
          const grantId = uniqueKey("c6");
          const res = await retryShedding(() =>
            gameApi.grant(request, game, { grantId, playerId, itemId: entry.itemId })
          );
          const refused = !isSuccess(res.status) || res.body?.error || res.body?.errors;
          if (refused) {
            undeliverable.push(`${playerId} ${entry.itemId} → HTTP ${res.status} ${describe(res.body)}`);
          }
        }
      }

      expect(undeliverable, "offered to the player, then refused at delivery").toEqual([]);
    });

    // "POST /game/v1/grants → Response 201 { grantId, playerId, itemId, quantity, status: "granted", grantedAt }"
    test(title(game.gameId, "C7", "a new grant returns 201 granted and echoes our grantId"), async ({ request }) => {
      const grantId = uniqueKey("c7");
      const res = await retryShedding(() => gameApi.grant(request, game, { grantId, playerId: player, itemId: item }));
      const body = res.body;

      expect.soft(res.status, `status, body ${describe(body)}`).toBe(201);
      expect.soft(body?.status, "grant status").toBe("granted");
      expect.soft(body?.grantId, "grantId is the one the platform sent").toBe(grantId);
      expect.soft(body?.playerId, "playerId").toBe(player);
      expect.soft(body?.itemId, "itemId").toBe(item);
      expect.soft(typeof body?.grantedAt, "grantedAt").toBe("string");
    });

    // "Synchronous. The response reflects the final outcome. When the platform
    //  gets a success it treats the item as delivered."
    test(title(game.gameId, "C8", "the item is owned as soon as the grant succeeds"), async ({ request }) => {
      const before = await baseline(request);
      const res = await retryShedding(() => gameApi.grant(request, game, { playerId: player, itemId: item }));
      const after = await owned(request);

      expect(isSuccess(res.status), `grant status ${res.status}, body ${describe(res.body)}`).toBe(true);
      expect(after - before, "items owned immediately after the success response").toBe(1);
    });

    // "A repeated call with the same grantId must not deliver the item a second
    //  time; it returns 200 with the original grant."
    test(title(game.gameId, "C9", "repeating a grantId returns 200 and does not deliver again"), async ({ request }) => {
      const grantId = uniqueKey("c9");
      const before = await baseline(request);

      const first = await retryShedding(() => gameApi.grant(request, game, { grantId, playerId: player, itemId: item }));
      const second = await retryShedding(() => gameApi.grant(request, game, { grantId, playerId: player, itemId: item }));
      const after = await pollUntil(() => owned(request), (count) => count >= before + 1, SETTLE);
      await sleep(SETTLE.intervalMs);
      const settled = await owned(request);

      expect.soft(isSuccess(first.status), `first call status ${first.status}`).toBe(true);
      expect.soft(second.status, `replay status, body ${describe(second.body)}`).toBe(200);
      expect.soft(second.body?.grantId, "replay returns the original grant").toBe(first.body?.grantId);
      expect.soft(Math.max(after, settled) - before, "items delivered for one grantId sent twice").toBe(1);
    });

    // "GET /game/v1/grants/{grantId} → Returns a previously created grant, 404 when there is none."
    test(title(game.gameId, "C10", "a grant can be read back by its id, unknown ids return 404"), async ({ request }) => {
      const grantId = uniqueKey("c10");
      await retryShedding(() => gameApi.grant(request, game, { grantId, playerId: player, itemId: item }));

      const known = await retryShedding(() => gameApi.getGrant(request, game, grantId));
      const unknown = await retryShedding(() => gameApi.getGrant(request, game, uniqueKey("missing")));

      expect.soft(known.status, `read back by the grantId the platform sent, body ${describe(known.body)}`).toBe(200);
      expect.soft(known.body?.grantId, "grant returned").toBe(grantId);
      expect.soft(unknown.status, `unknown grant, body ${describe(unknown.body)}`).toBe(404);
    });

    // "POST /game/v1/grants/{grantId}/revoke → 200 with "status": "revoked".
    //  Required. A player who has been refunded must not keep the item."
    // "GET .../inventory → Revoked grants are excluded."
    test(title(game.gameId, "C11", "revoking a grant returns 200 revoked and removes the item"), async ({ request }) => {
      const grantId = uniqueKey("c11");
      const before = await baseline(request);
      await retryShedding(() => gameApi.grant(request, game, { grantId, playerId: player, itemId: item }));
      await pollUntil(() => owned(request), (count) => count >= before + 1, SETTLE);

      const res = await retryShedding(() => gameApi.revoke(request, game, grantId));
      const after = await pollUntil(() => owned(request), (count) => count <= before, SETTLE);

      expect.soft(res.status, `revoke status, body ${describe(res.body)}`).toBe(200);
      expect.soft(res.body?.status, "revoke result").toBe("revoked");
      expect.soft(after - before, "items still owned after the revoke").toBe(0);
    });

    // "Failures use an HTTP status that reflects the problem, with { "error": "some_code" }.
    //  A 2xx status means the call succeeded."
    test(title(game.gameId, "C12", "failures use an error status and an { error } body"), async ({ request }) => {
      const failures = [
        {
          label: "unknown player",
          call: () => gameApi.player(request, game, game.unknownPlayer),
        },
        {
          label: "unknown grant",
          call: () => gameApi.getGrant(request, game, uniqueKey("missing")),
        },
        {
          label: "grant for unknown player",
          call: () => gameApi.grant(request, game, { playerId: game.unknownPlayer, itemId: item }),
        },
        {
          label: "grant of unknown item",
          call: () => gameApi.grant(request, game, { playerId: player, itemId: "no_such_item" }),
        },
      ];

      for (const failure of failures) {
        const res = await retryShedding(failure.call);
        expect.soft(res.status, `${failure.label}: reported as HTTP ${res.status}, body ${describe(res.body)}`).toBeGreaterThanOrEqual(400);
        expect.soft(typeof res.body?.error, `${failure.label}: { error } in ${describe(res.body)}`).toBe("string");
      }
    });

    // "GET .../inventory → { playerId, items: [ { itemId, quantity } ] }"
    test(title(game.gameId, "C13", "inventory has the documented shape"), async ({ request }) => {
      const before = await owned(request);
      await retryShedding(() => gameApi.grant(request, game, { playerId: player, itemId: item }));
      await pollUntil(() => owned(request), (count) => count >= before + 1, SETTLE);

      const res = await gameApi.inventory(request, game, player);
      const body = res.body;

      expect(res.status, "inventory status").toBe(200);
      expect.soft(body?.playerId, "playerId").toBe(player);
      expect(Array.isArray(body?.items), `items array in ${describe(body)}`).toBe(true);
      expect(body.items.length, "items after a grant").toBeGreaterThan(0);
      for (const entry of body.items) {
        expect.soft(typeof entry.itemId, `itemId in ${describe(entry)}`).toBe("string");
        expect.soft(Number.isInteger(entry.quantity) && entry.quantity > 0, `quantity in ${describe(entry)}`).toBe(true);
      }
    });

    // "The platform allows 2 seconds per call before it gives up and retries."
    test(title(game.gameId, "C14", "calls answer within the platform's 2 second limit"), async ({ request }) => {
      const samples = 30;
      const slow: number[] = [];
      for (let i = 0; i < samples; i++) {
        const res = await gameApi.catalog(request, game, player);
        if (res.ms >= TIMEOUT_MS) {
          slow.push(res.ms);
        }
      }

      expect(slow, `catalog calls over ${TIMEOUT_MS} ms, out of ${samples}`).toEqual([]);
    });
  });
}
