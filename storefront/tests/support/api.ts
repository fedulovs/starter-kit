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
