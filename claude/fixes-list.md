# Possible Fixes (our code only)

Candidate fixes in `storefront/` and `platform/`, the code we own. Games in
`games/` are out of scope; their defects go to game-team write-ups instead.
Context: [architecture.md](architecture.md), [support-tickets-triage.md](support-tickets-triage.md).

Test IDs refer to the planned suites: C = game contract, I = store ↔ game agreement, U = UI smoke.

| # | Fix | Where | Effort | Fixes |
|---|---|---|---|---|
| F1 | Add a `failed` branch to `statusLabel` | `storefront/src/view.ts` | XS | PS-330 display, U3 |
| F2 | `formatPrice` uses the currency (`Intl.NumberFormat`) | `storefront/src/view.ts` | XS | U7 |
| F3 | Tide: a 2xx with an `error` body counts as failed | `TideFarmAdapter.parseGrant` / `parseRevoke` | XS | PS-366, I1 |
| F4 | Iron price via `BigDecimal` with rounding, not a `(long)` cast | `IronSiegeAdapter.parseCatalog` | XS | I7 |
| F5 | One `grantId` per order, reused across retries | `OrderService.deliver` | S | I3 (Nova/Tide; not Iron) |
| F6 | Refund: allow only from `delivered`, check `parseRevoke`, don't mark `refunded` if the revoke fails | `OrderService.refund` | S | I5, I6 |
| F7 | Catalogue failure → 502 `game_unavailable`, not an empty list | `CatalogService` + `PlatformMain` | S | PS-318, I9 |
| F8 | Idempotency key generated once per checkout; Pay disabled while in flight | `storefront/public/app.js` | S | PS-341, U4 |
| F9 | `putIfAbsent` for the idempotency map | `OrderService.createOrder` | XS | concurrency race |
| F10 | Tide: hide offers above the player's level | `TideFarmAdapter` (needs a player fetch) | M | PS-330, I8 |
| F11 | Void the payment when the order fails | `storefront/src/server.ts` + `payments.ts` stub | M | charged with no item |
| F12 | Drift: no EUR default, treat 409 as "look it up", follow up pending grants | `DriftClubAdapter` / `OrderService` | M–L | Drift go-live |

Effort: XS ≈ minutes, S ≈ under 30 min, M ≈ about an hour, L ≈ more.

## If time is short

1. **F1, F3, F4.** Three one-liners that fix wrong behaviour players see today.
2. **F5, F6.** The next best value: duplicate grants and refunds that leave the item.

## Notes

- F5 does not stop duplicates on Iron Siege, which ignores `grantId`. That needs a
  separate decision (don't retry grants on timeout for Iron, or check inventory
  before retrying).
- F6 changes what the refund endpoint returns on failure. Decide whether to add a
  `refund_pending` status or return an error.
- Each fix should turn its linked failing test(s) green. Keep the test as a regression check.
