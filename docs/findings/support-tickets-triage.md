# Support Tickets: Triage and Action Plan

Companion to [architecture.md](../../claude/architecture.md). It takes the eight tickets in
`docs/support-tickets.md`, groups them by **failure type** (with game as a tag),
links each one to a root cause in the code, and lists what to do about it.

**Status of evidence:** every "Reproduced" line below was run against the local
stack on 2026-10-18 (`./start.sh`, fresh in-memory state). Commands are
included so anyone can re-run them. Restarting the stack resets all state.

**Ownership rule (from ASSIGNMENT.md):** `storefront/` and `platform/` are ours.
`games/` cannot change, so a game-side defect is either *absorbed in our layer*
or *written up for the game team*.

---

## 1. Summary

| # | Category | Tickets | Games | Severity | Reproduced | Fix lives in |
|---|---|---|---|---|---|---|
| A | Store status ≠ game reality | PS-366, PS-330, PS-358, PS-291 | Tide, Iron | **P1**: money and items disagree | ✔ | Platform + storefront (+ game asks) |
| B | Duplicate delivery / purchase | PS-291, PS-341 | Iron | **P1**: value given away, double charge | ✔ | Platform + storefront (+ Iron ask) |
| C | Offer shown that can't be delivered | PS-330 | Tide (Drift latent) | **P2**: charge with no item | ✔ | Platform |
| D | Store degraded or unavailable | PS-318, PS-341 | Iron | **P2**: lost sales, confusion | ✔ | Platform + storefront |
| E | Not a system defect / out of scope | PS-304, PS-349 | Nova, — | P4 | n/a | None |
| S | **Silent: no tickets will ever arrive** | none | Iron, Tide, Drift, all | **P1** (refunds, Drift go-live) | ✔ | Platform + storefront |

Tickets appear in more than one row on purpose: one ticket can have several
causes, and one cause can produce several tickets.

### Ticket → category

| Ticket | Game | A | B | C | D | E | Status |
|---|---|---|---|---|---|---|---|
| PS-291 Error shown, pass on account, bought twice | Iron | ● | ● | | | | open |
| PS-304 Gems on second account | Nova | | | | | ● | closed |
| PS-318 Shop empty ~10 min | Iron | | | | ● | | open |
| PS-330 Harvest Pass never arrived, L4 | Tide | ● | | ● | | | open |
| PS-341 Hung for seconds, pressed buy again | Iron | | ● | | ● | | open |
| PS-349 Narrow phone layout | — | | | | | ● | won't fix |
| PS-358 Shows failed, items arrived | Iron | ● | | | | | open, "suggest closing" |
| PS-366 Tractor: delivered, got nothing | Tide | ● | | | | | open |

> **PS-358 should not be closed.** It is reproducible (category A) and recurs by design.

---

## 2. Categories

### A. Store status ≠ game reality

The player's order says one thing and the game says another. There are two directions:

| Direction | Ticket | Chain |
|---|---|---|
| **Says delivered / looks fine, nothing arrived** | PS-366 | Tide returns `200 {"error":"out_of_stock"}` → `TideFarmAdapter.parseGrant` treats any 200 as granted → order `delivered` |
| | PS-330 | Tide returns `422 level_too_low` → order `failed` correctly → **`view.ts statusLabel` maps `failed` → "Delivered"** → player sees success |
| **Says failed, item arrived** | PS-358, PS-291 | Iron sleeps 2.2–2.9 s *before* processing (10% of calls) → platform's 2 s timeout fires → retry or `delivery_transport_error` → order `failed` while Iron grants anyway |

**Reproduced:**
- PS-366: 3 × `golden_tractor` for p-1003 → **3 orders `delivered`, game inventory holds 2**.
- PS-330: `harvest_pass` for p-1002 (L3) → platform `status:"failed", failureReason:"level_too_low"`;
  storefront `/api/orders/{id}` → **`"label":"Delivered"`**.
- PS-358: 60 Iron orders → 2 `failed delivery_transport_error` and 4 `failed service_unavailable`.
  Game grants exceeded delivered orders by 11 (see B).

**Actions:**
1. **Test (platform, unit):** every adapter's `parseGrant` with a 200 error body →
   must not return `granted`. Fails today for Tide.
2. **Test (storefront, unit, vitest):** `statusLabel({status:"failed"})` must not be
   "Delivered". Fails today. Cheapest test in the repo.
3. **Fix (ours):** `TideFarmAdapter.parseGrant` checks `body.error` before
   trusting 2xx. `statusLabel` gets an explicit `failed` branch.
4. **Fix (ours):** after a timeout, look the grant up (`GET /game/v1/grants/{id}`)
   before declaring failure. Note that Iron Siege mints its own IDs, so lookup
   by our grantId won't find the grant on Iron (see B).
5. **Tooling:** a reconciliation check that, per player/game, compares
   platform orders (`delivered`) with game inventory. This is what the support
   console *should* show and today doesn't (docs: "nobody has checked it").
6. **Game-team ask (Tide):** use non-2xx for `out_of_stock` / `player_not_found`
   as the contract says.

### B. Duplicate delivery / purchase

The player gets more than they paid for, or pays twice.

**Chain (three independent layers, all failing):**
1. **Storefront UI:** `app.js` generates `idempotencyKey = crypto.randomUUID()`
   **per Pay click**, and Pay is not disabled while in flight. A second click is
   a second order and a second charge. (PS-341)
2. **Platform:** `OrderService.deliver` generates a **new `grantId` per attempt**,
   which defeats game-side idempotency even on games that support it.
3. **Iron Siege:** ignores `grantId` entirely and mints a new award every call,
   with no idempotency. A request it is "too slow" on still completes.

**Reproduced:** 60 sequential `siege_pass` orders for p-1001 →
`47 delivered`, but **58 grants added** in Iron Siege inventory (**+11 undelivered-on-paper items**, ~23%).

**Actions:**
1. **Test (platform, integration):** stub game that delays > 2 s then succeeds →
   assert exactly one grant per order. Fails today.
2. **Test (platform, unit):** both delivery attempts reuse the same `grantId`. Fails today.
3. **Test (e2e, Playwright):** double-click Pay → expect one order. Fails today.
4. **Fix (ours):** keep one `grantId` per order across retries. Generate the
   idempotency key once per checkout dialog, not per click, and disable Pay in flight.
5. **Fix (ours):** for Iron Siege specifically, reusing the grantId isn't
   enough. The options are not retrying grants on timeout for non-idempotent games, or
   reconciling via inventory before retrying. This needs a decision.
6. **Game-team ask (Iron):** honour `grantId` as the idempotency key (hard
   requirement in the contract). Process-then-sleep vs. sleep-then-process
   is not ours to change.

### C. Offer shown that can't be delivered

**Chain:** the contract says catalogs must be eligibility-filtered. Tide returns
the full catalog with `minLevel` and gates only at grant time. The platform
ignores `minLevel`. The storefront charges the card *before* creating the order
and never reverses it.

**Reproduced:** p-1002 (L3) offers include `harvest_pass` (minLevel 10) and
`golden_tractor` (25). Buying one → `failed level_too_low` after payment authorised.
Latent on Drift Club: `vip.lounge` is listed but every grant returns `422 ITEM_NOT_GRANTABLE`.

**Actions:**
1. **Test (platform, contract):** for each game × player, every offer returned
   must be grantable. Fails for Tide (L3/L12 players) and Drift (`vip.lounge`).
2. **Fix (ours):** filter Tide offers by `minLevel` vs. player level (fetch
   `GET /players/{id}`) in `TideFarmAdapter`. Drop `vip.lounge` or other known
   non-grantable items for Drift.
3. **Fix (ours):** void or refund the payment when order creation fails
   (`server.ts /api/checkout`). Today a failed order keeps the money.

### D. Store degraded or unavailable

**Chain:** Iron Siege sheds 8% (503) and is slow on ~10% of calls (> 2 s).
`CatalogService.offersFor` swallows *every* error and non-200 into an empty
list, returned as HTTP 200. The UI shows "No offers available." A purchase also
re-reads the catalog twice (BFF checkout plus platform `findOffer`), so a
healthy-looking offer can fail with `offer_not_found`. Up to two 2 s grant
attempts plus a 250 ms payment means **~4.5 s of silent spinner**.

**Reproduced:** 60 offer reads for Iron → **10 empty** (~17%). 60 orders → **7
`404 offer_not_found`** for an offer that exists.

**Actions:**
1. **Test (platform):** a failing game catalog must surface as an error
   (5xx / `game_unavailable`), not `200 {"offers":[]}`. Fails today. Related:
   unknown gameId returns `200 []` instead of `404 unknown_game`.
2. **Fix (ours):** distinguish "no offers" from "couldn't load", and retry
   catalog reads (they're idempotent). Consider short-lived caching so
   `findOffer` doesn't re-hit a flaky game.
3. **Fix (ours, UI):** an in-flight state on Pay, plus a "couldn't load, retry"
   message instead of an empty shop.
4. **Monitoring idea:** per-game catalog error/empty rate. PS-318's "10 minutes"
   would be a visible spike.

### E. Not a system defect / out of scope

- **PS-304 (Nova):** purchase on the player's other account. Nova is the
  conformant game, and nothing in the code suggests misrouting. *No action.*
- **PS-349:** narrow-screen layout, won't fix. *No action.* (Can be added to e2e
  at a mobile viewport if the decision changes.)

---

## 3. Silent risks: no tickets will ever arrive

The ticket queue only captures failures that **players notice and lose from**.
These were found in code and confirmed live, but no player will report them.

| Risk | Reproduced | Impact | Action |
|---|---|---|---|
| **Refund doesn't revoke on Iron Siege**: revoke route is 404, platform ignores the response and marks `refunded` | ✔ refund → `refunded`, direct revoke → `404` | Player refunded **and keeps item** (handover: "a refunded player must not keep the item") | Test: refund → item gone from game inventory, per game. Fix: check the `parseRevoke` result. Don't mark `refunded` on failure (or add `refund_pending`). Game ask for Iron. |
| **Refund is a no-op on Drift Club**: acks 200, changes nothing | ✔ items after refund: 1 | Same, from go-live | Same test. Blocker for Drift go-live. |
| **Tide revoke expires after 24 h** | Code only (needs clock control) | Late refunds leave item | Document window; surface failed revokes |
| **Refund of failed order / double refund**: `grantId: null` → `/grants/null/revoke`, always `refunded`, repeatable | ✔ | Bad finance data | Test: refund only from `delivered`. Second refund → 409 |
| **Payment never reversed** on order failure or refund (storefront) | Code | Charged with no item (A, C) | Covered in C.3 |
| **Iron Siege price 19.99 → 1998** (`(long)(price*100)` truncates) | ✔ `priceMinor:1998` | Undercharge on every Scrap Hoard | Test: adapters round half-up to minor units. Fix: `BigDecimal` like Tide |
| **Iron `"gems_large "` trailing space** in offerId | ✔ | Offer ID instability; UI trims, API doesn't | Normalise (trim) in adapter. Contract-test ID format |
| **Drift Club currency**: no field, adapter defaults to `EUR`, real economy is USD | ✔ offers say `EUR` | Wrong currency at go-live | Go-live blocker. Confirm currency with team, don't default |
| **Storefront always shows `€`** (`formatPrice` ignores currency) | Code | Wrong symbol for any non-EUR game | vitest: `formatPrice(999,"USD")` ≠ `€9.99` |
| **Drift orders stay `pending` forever**: 202 is never followed up | ✔ order `pending` after 2 s while game shows `granted` | UI shows "Processing…" forever | Poll `GET /grants/{id}` / reconcile. Go-live blocker |
| **Drift `409` on replayed grantId** is treated as failure | Code | A retry after a lost response marks a delivered order failed | Adapter: 409 → look up grant. Test |
| **Idempotency check-then-put race** in `OrderService` | Code | Concurrent same-key requests can make 2 orders | Concurrency test. `putIfAbsent` |

---

## 4. Suggested order of work (fits a timebox)

1. **Quick, failing, high-signal tests** (≈30 min). These alone demonstrate four
   P1/P2 defects:
   `statusLabel(failed)`, `TideFarmAdapter.parseGrant(200,{error})`,
   `IronSiegeAdapter` price 19.99 → 1999, `formatPrice` currency.
2. **Contract-conformance suite** against the four games (≈60 min): one
   parameterised test per contract rule × game. This turns the matrix in
   architecture.md §5.2 into executable evidence and answers the handover
   question "is this integration ready?". Drift Club failing it is the go-live finding.
3. **End-to-end reconciliation check** (≈45 min): place N orders per game
   through the platform, then compare order statuses with game inventory and
   assert refund removes items. This catches A, B and the refund risks in one tool.
4. **Targeted fixes in our layer** where cheap and contained: `statusLabel`,
   Tide 200-error parsing, Iron price rounding, refund status honesty, stable
   grantId per order.
5. **Write-ups for game teams**: Iron (idempotency, revoke, 404 vs 500), Tide
   (2xx errors, eligibility filtering, inventory shape), Drift (202/409
   semantics, currency, revoke no-op, error envelope).

### Drift Club go-live view (fixed date, end of next week)

Blockers found so far: refund no-op, currency unknown (defaults to EUR),
orders stuck `pending`, `vip.lounge` unpurchasable but listed, 409 on replay,
dotted item IDs, `p-1003` unlinked → empty shop. None will show up as tickets
before launch. They will show up after.

---

## 5. Re-running the reproductions

Requires `./start.sh` running. Orders hit the platform directly (no payment step).

```bash
# helper
order() { curl -s -X POST http://localhost:4000/v1/orders -H 'Content-Type: application/json' \
  -H 'X-Platform-Preview: true' \
  -d "{\"gameId\":\"$1\",\"playerId\":\"$2\",\"offerId\":\"$3\",\"idempotencyKey\":\"k-$RANDOM$RANDOM\"}"; echo; }
```

| Ticket / risk | Steps | Expected today |
|---|---|---|
| PS-366 | `order tide-farm p-1003 golden_tractor` × 3, then `curl localhost:4102/game/v1/players/p-1003/inventory` | 3 × `delivered`, 2 tractors in inventory |
| PS-330 | `order tide-farm p-1002 harvest_pass`, then `curl localhost:3000/api/orders/<orderId>` | platform `failed`, storefront `"label":"Delivered"` |
| PS-358 / PS-291 / B | Loop ~60 × `order iron-siege p-1001 siege_pass`, wait 3 s, count `siege_pass` in `localhost:4103/game/v1/players/p-1001/inventory` | Some `failed`; game grants > delivered orders |
| PS-318 / D | Loop ~60 × `curl 'localhost:4000/v1/games/iron-siege/offers?playerId=p-1001'` | ~15–20% `"offers":[]` with HTTP 200 |
| Refund (Iron) | `order iron-siege …`, `POST /v1/orders/<id>/refund`, check inventory | `refunded`, item still present |
| Refund (Drift) | `order drift-club p-1002 drift.pass`, wait 2 s, refund, check inventory | `refunded`, item still present. Order stuck `pending` |
| Price | `curl 'localhost:4000/v1/games/iron-siege/offers?playerId=p-1001'` | Scrap Hoard `priceMinor: 1998` |

Iron Siege results are probabilistic (10% slow, 8% 503 per call). Use ≥ 50
iterations, and assert on *invariants* (grants == delivered orders), not on exact counts.
