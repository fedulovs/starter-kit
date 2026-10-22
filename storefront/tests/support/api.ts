/**
 * HTTP helpers shared by the api suite.
 *
 * They return what came back (status, body, timing) and never assert, so a
 * test decides what "correct" means. Bodies are parsed leniently: a game that
 * answers with something other than JSON yields `body: null`, not a crash.
 */

import type { APIRequestContext, APIResponse } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PLATFORM_URL, type GameUnderTest } from "./games.js";

export interface Reply<T = any> {
  status: number;
  body: T;
  ms: number;
}

async function reply<T>(started: number, response: APIResponse): Promise<Reply<T>> {
  const ms = Date.now() - started;
  const text = await response.text();
  let body: any = null;
  try {
    body = text.length ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status(), body, ms };
}

/** Generous enough that a slow game is measured, not cut off. */
const CALL_TIMEOUT_MS = 10_000;

export async function get<T = any>(request: APIRequestContext, url: string): Promise<Reply<T>> {
  const started = Date.now();
  return reply<T>(started, await request.get(url, { timeout: CALL_TIMEOUT_MS }));
}

export async function post<T = any>(
  request: APIRequestContext,
  url: string,
  data: unknown = {},
  headers: Record<string, string> = {}
): Promise<Reply<T>> {
  const started = Date.now();
  return reply<T>(
    started,
    await request.post(url, { data, headers, timeout: CALL_TIMEOUT_MS })
  );
}

export function uniqueKey(prefix = "qa"): string {
  return `${prefix}-${randomUUID()}`;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Re-reads `read` until `done` holds or the time runs out; returns the last value. */
export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 5_000, intervalMs = 250 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(intervalMs);
    value = await read();
  }
  return value;
}

/**
 * Repeats a call while it answers 503. Iron Siege is documented to shed load,
 * and a shed request says nothing about the rule a test is checking. It sheds
 * before processing, so repeating is safe even for grants. Only 503 is
 * retried: any other status is the game's real answer.
 */
export async function retryShedding<T>(
  call: () => Promise<Reply<T>>,
  attempts = 4
): Promise<Reply<T>> {
  let result = await call();
  for (let attempt = 1; attempt < attempts && result.status === 503; attempt++) {
    await sleep(200);
    result = await call();
  }
  return result;
}

// --- Game integration API (direct) -------------------------------------------

export const gameApi = {
  health: (request: APIRequestContext, game: GameUnderTest) =>
    get(request, `${game.baseUrl}/game/v1/health`),

  player: (request: APIRequestContext, game: GameUnderTest, playerId: string) =>
    get(request, `${game.baseUrl}/game/v1/players/${encodeURIComponent(playerId)}`),

  catalog: (request: APIRequestContext, game: GameUnderTest, playerId: string) =>
    get(request, `${game.baseUrl}/game/v1/catalog?playerId=${encodeURIComponent(playerId)}`),

  inventory: (request: APIRequestContext, game: GameUnderTest, playerId: string) =>
    get(request, `${game.baseUrl}/game/v1/players/${encodeURIComponent(playerId)}/inventory`),

  grant: (
    request: APIRequestContext,
    game: GameUnderTest,
    grant: { grantId?: string; playerId: string; itemId: string; quantity?: number }
  ) =>
    post(request, `${game.baseUrl}/game/v1/grants`, {
      grantId: grant.grantId ?? randomUUID(),
      playerId: grant.playerId,
      itemId: grant.itemId,
      quantity: grant.quantity ?? 1,
    }),

  getGrant: (request: APIRequestContext, game: GameUnderTest, grantId: string) =>
    get(request, `${game.baseUrl}/game/v1/grants/${encodeURIComponent(grantId)}`),

  revoke: (request: APIRequestContext, game: GameUnderTest, grantId: string) =>
    post(request, `${game.baseUrl}/game/v1/grants/${encodeURIComponent(grantId)}/revoke`),
};

/**
 * How many of `itemId` the game says the player owns.
 *
 * Reads both the documented shape (`items[].quantity`) and Tide Farm's
 * inherited one (`inventory[].count`), so agreement tests measure ownership
 * whatever the shape; the shape itself is checked by the contract tests.
 * Item ids are compared trimmed for the same reason.
 */
export function countOwned(inventoryBody: any, itemId: string): number {
  const entries: any[] = inventoryBody?.items ?? inventoryBody?.inventory ?? [];
  return entries
    .filter((entry) => String(entry?.itemId ?? "").trim() === itemId.trim())
    .reduce((sum, entry) => sum + Number(entry?.quantity ?? entry?.count ?? 0), 0);
}

/**
 * Ownership once the inventory has stopped changing. A queue-backed game can
 * still be applying grants from an earlier test; counting from a moving
 * baseline would credit those to the test that is measuring.
 */
export async function settledOwned(
  request: APIRequestContext,
  game: GameUnderTest,
  playerId: string,
  itemId: string,
  { quietMs = 2_000, maxChecks = 4 } = {}
): Promise<number> {
  let previous = await ownedInGame(request, game, playerId, itemId);
  for (let check = 0; check < maxChecks; check++) {
    await sleep(quietMs);
    const current = await ownedInGame(request, game, playerId, itemId);
    if (current === previous) {
      return current;
    }
    previous = current;
  }
  return previous;
}

export async function ownedInGame(
  request: APIRequestContext,
  game: GameUnderTest,
  playerId: string,
  itemId: string
): Promise<number> {
  const { body } = await gameApi.inventory(request, game, playerId);
  return countOwned(body, itemId);
}

// --- Platform API ------------------------------------------------------------

export const platformApi = {
  games: (request: APIRequestContext) => get(request, `${PLATFORM_URL}/v1/games`),

  offers: (request: APIRequestContext, gameId: string, playerId: string) =>
    get(
      request,
      `${PLATFORM_URL}/v1/games/${gameId}/offers?playerId=${encodeURIComponent(playerId)}`
    ),

  /** Non-live games need `preview: true`, as the storefront does in preview mode. */
  order: (
    request: APIRequestContext,
    order: {
      gameId: string;
      playerId: string;
      offerId: string;
      idempotencyKey?: string;
      preview?: boolean;
    }
  ) =>
    post(
      request,
      `${PLATFORM_URL}/v1/orders`,
      {
        gameId: order.gameId,
        playerId: order.playerId,
        offerId: order.offerId,
        idempotencyKey: order.idempotencyKey ?? uniqueKey("order"),
      },
      order.preview ? { "X-Platform-Preview": "true" } : {}
    ),

  getOrder: (request: APIRequestContext, orderId: string) =>
    get(request, `${PLATFORM_URL}/v1/orders/${orderId}`),

  playerOrders: (request: APIRequestContext, playerId: string) =>
    get(request, `${PLATFORM_URL}/v1/players/${encodeURIComponent(playerId)}/orders`),

  refund: (request: APIRequestContext, orderId: string) =>
    post(request, `${PLATFORM_URL}/v1/orders/${orderId}/refund`),

  inventory: (request: APIRequestContext, gameId: string, playerId: string) =>
    get(
      request,
      `${PLATFORM_URL}/v1/games/${gameId}/players/${encodeURIComponent(playerId)}/inventory`
    ),
};

/** Failures caused by Iron Siege shedding load or being slow, not by the order itself. */
export const TRANSIENT_FAILURES = ["service_unavailable", "delivery_transport_error"];

/**
 * Places orders until one comes back the way a test's setup needs it (e.g. a
 * delivered order to refund). Setup only: the behaviour under test must not
 * be retried away. Each attempt is a new order with its own key, so a test
 * that checks key replay must make its own repeat calls.
 */
export async function orderUntil(
  request: APIRequestContext,
  input: { gameId: string; playerId: string; offerId: string; preview?: boolean },
  wanted: (order: any) => boolean,
  attempts = 10
): Promise<any> {
  let last: Reply | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await platformApi.order(request, { ...input, idempotencyKey: uniqueKey("setup") });
    if (wanted(last.body)) {
      return last.body;
    }
  }
  throw new Error(
    `setup: no suitable ${input.gameId} order after ${attempts} attempts, last ${last?.status} ${JSON.stringify(last?.body)}`
  );
}
