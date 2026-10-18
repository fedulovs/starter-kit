/** Client for the player platform API. */

export const PLATFORM_URL = process.env.PLATFORM_URL ?? "http://localhost:4000";

export interface Game {
  gameId: string;
  displayName: string;
  live: boolean;
}

export interface Offer {
  gameId: string;
  offerId: string;
  gameItemId: string;
  name: string;
  priceMinor: number;
  currency: string;
}

export interface Order {
  orderId: string;
  gameId: string;
  playerId: string;
  offerId: string;
  priceMinor: number;
  currency: string;
  status: "pending" | "delivered" | "failed" | "refunded";
  grantId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PLATFORM_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error ?? "platform_error"), {
      status: response.status,
      body,
    });
  }
  return body as T;
}

export function listGames(): Promise<{ games: Game[] }> {
  return call("/v1/games");
}

export function listOffers(gameId: string, playerId: string): Promise<{ offers: Offer[] }> {
  return call(`/v1/games/${gameId}/offers?playerId=${encodeURIComponent(playerId)}`);
}

export function createOrder(
  input: {
    gameId: string;
    playerId: string;
    offerId: string;
    idempotencyKey: string;
  },
  preview = false
): Promise<Order> {
  return call("/v1/orders", {
    method: "POST",
    body: JSON.stringify(input),
    headers: preview ? { "X-Platform-Preview": "true" } : {},
  });
}

export function getOrder(orderId: string): Promise<Order> {
  return call(`/v1/orders/${orderId}`);
}

export function listOrders(playerId: string): Promise<{ orders: Order[] }> {
  return call(`/v1/players/${encodeURIComponent(playerId)}/orders`);
}

export function gameInventory(
  gameId: string,
  playerId: string
): Promise<{ gameId: string; status: number; body: unknown }> {
  return call(`/v1/games/${gameId}/players/${encodeURIComponent(playerId)}/inventory`);
}

export function refundOrder(orderId: string): Promise<Order> {
  return call(`/v1/orders/${orderId}/refund`, { method: "POST", body: "{}" });
}
