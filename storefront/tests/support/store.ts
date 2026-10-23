/**
 * Page helpers for the storefront UI (public/index.html, public/support.html).
 *
 * They drive the page the way a player does and hand back what the backend
 * answered, so a test can tie what is on screen to a specific order. Like the
 * API helpers, they never assert on the behaviour under test.
 */

import type { APIRequestContext, Page } from "@playwright/test";

export const DEFAULT_CARD = "4242 4242 4242 4242";
/** The stub provider's test-mode decline (storefront/src/payments.ts). */
export const DECLINED_CARD = "4000 0000 0000 0002";

export interface CheckoutResult {
  status: number;
  body: any;
}

/** Opens the store as `playerId` with `gameId`'s tab selected and its offers loaded. */
export async function openStore(page: Page, playerId: string, gameId: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("player-select").selectOption(playerId);
  await page.getByTestId(`game-${gameId}`).click();
  await page.getByTestId("offers").locator("li").first().waitFor();
}

export function offer(page: Page, offerId: string) {
  return page.getByTestId(`offer-${offerId}`);
}

/** Opens checkout for an offer and fills in the card. Does not pay. */
export async function startCheckout(page: Page, offerId: string, cardNumber = DEFAULT_CARD) {
  await offer(page, offerId).getByTestId("buy").click();
  const dialog = page.getByTestId("checkout");
  await dialog.getByTestId("card-number").fill(cardNumber);
  return dialog;
}

/** Clicks Pay once and returns the storefront's /api/checkout answer. */
export async function pay(page: Page): Promise<CheckoutResult> {
  const answered = page.waitForResponse(
    (response) => response.url().endsWith("/api/checkout") && response.request().method() === "POST"
  );
  await page.getByTestId("checkout-pay").click();
  const response = await answered;
  return { status: response.status(), body: await response.json().catch(() => null) };
}

/** Full purchase: open checkout, fill the card, pay. */
export async function buy(page: Page, offerId: string, cardNumber = DEFAULT_CARD): Promise<CheckoutResult> {
  await startCheckout(page, offerId, cardNumber);
  return pay(page);
}

export function orderRow(page: Page, orderId: string) {
  return page.getByTestId(`order-${orderId}`);
}

/** The player's orders as the storefront reports them (same source the page uses). */
export async function storeOrders(request: APIRequestContext, playerId: string): Promise<any[]> {
  const response = await request.get(`/api/orders?playerId=${encodeURIComponent(playerId)}`);
  return (await response.json()).orders ?? [];
}

/** Games the storefront shows, i.e. live ones, plus non-live ones in preview mode. */
export async function storeGames(request: APIRequestContext): Promise<any[]> {
  const response = await request.get("/api/games");
  return (await response.json()).games ?? [];
}
