/**
 * Stand-in for the payment provider.
 *
 * The real integration is not part of this stack; this authorises a card and
 * hands back a reference, with the same shape of outcome a provider would give.
 */

export interface Card {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
}

export interface Payment {
  paymentRef: string;
  status: "authorised" | "declined";
  last4: string;
  amountMinor: number;
  currency: string;
  declineReason?: string;
}

/** Cards the provider treats specially in its test mode. */
const DECLINED = "4000000000000002";

function digits(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

export function last4(cardNumber: string): string {
  return digits(cardNumber).slice(-4);
}

export async function authorise(
  card: Card,
  amountMinor: number,
  currency: string
): Promise<Payment> {
  // Providers are not instant.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const number = digits(card.number);
  const reference = `pay_${Math.random().toString(36).slice(2, 14)}`;

  if (number.length < 12) {
    return {
      paymentRef: reference,
      status: "declined",
      last4: last4(number),
      amountMinor,
      currency,
      declineReason: "invalid_card_number",
    };
  }
  if (number === DECLINED) {
    return {
      paymentRef: reference,
      status: "declined",
      last4: last4(number),
      amountMinor,
      currency,
      declineReason: "card_declined",
    };
  }
  return {
    paymentRef: reference,
    status: "authorised",
    last4: last4(number),
    amountMinor,
    currency,
  };
}
