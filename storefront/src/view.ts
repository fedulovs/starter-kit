/**
 * View-model helpers shared by the storefront pages.
 *
 * These are plain functions on purpose: they are the cheapest place in the
 * stack to check how a value is presented to a player.
 */

import type { Offer, Order } from "./platform.js";

export function formatPrice(priceMinor: number, _currency: string): string {
  return `€${(priceMinor / 100).toFixed(2)}`;
}

export function offerView(offer: Offer) {
  return {
    offerId: offer.offerId,
    name: offer.name,
    price: formatPrice(offer.priceMinor, offer.currency),
  };
}

export function statusLabel(order: Order): string {
  if (order.status === "pending") {
    return "Processing…";
  }
  if (order.status === "refunded") {
    return "Refunded";
  }
  return "Delivered";
}

export function orderView(order: Order) {
  return {
    orderId: order.orderId,
    gameId: order.gameId,
    offerId: order.offerId,
    price: formatPrice(order.priceMinor, order.currency),
    currency: order.currency,
    label: statusLabel(order),
    status: order.status,
  };
}
