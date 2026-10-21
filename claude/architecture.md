# Player Store — Architecture Reference

A factual description of this repository for agents and engineers picking it up.
It covers what the system is, how the pieces talk to each other, what the docs
say, and what the code actually does. It contains **no recommendations**: where
the code differs from the docs, that is recorded as an observation only.

Source of truth, in order: the code under `storefront/`, `platform/`, `games/`;
then `docs/*.md`; then `README.md` / `ASSIGNMENT.md`. Line references are
`path:line` at the time of writing.

---

## 1. Context

- **Product:** Player Store, a web store that sells in-game items for several
  games, each built by a separate team.
- **Repo purpose:** take-home assignment for a Quality Engineering Lead
  (`ASSIGNMENT.md`). The goal is "materially better confidence" in the system
  within a 4-hour timebox. The deliverables are tests, findings, tooling and/or
  fixes, plus about a page of notes.
- **Ownership rules (from ASSIGNMENT.md):**
  - `storefront/` and `platform/` are ours. They may be changed.
  - `games/` belongs to other teams. Treat these as external services that
    **cannot be changed**. Anything built must work against them as they are.
    A patch for a game team may be written as documentation of a problem.
- **Game status:**

  | Game        | gameId       | Port | Live | Notes from docs |
  |-------------|--------------|------|------|-----------------|
  | Nova Arena  | `nova-arena` | 4101 | yes  | First integration; the API doc was written against it |
  | Tide Farm   | `tide-farm`  | 4102 | yes  | Sits on a legacy economy service; limited-run items (Golden Tractor) |
  | Iron Siege  | `iron-siege` | 4103 | yes  | Shared infra, sheds load (5xx, slow calls); original team gone |
  | Drift Club  | `drift-club` | 4104 | **no** | Integrated 2 weeks ago, go-live end of next week (fixed marketing date); queue-backed inventory; prices in **USD** |

- **Players** (seeded identically in every game except where noted):
  `p-1001` Aino L12, `p-1002` Bo L3, `p-1003` Cleo L40. Drift Club has no
  `p-1003` ("has not linked a Drift Club account yet").

---

## 2. Topology

```
 Browser (public/index.html, public/support.html)
   │  fetch /api/*
   ▼
 Storefront BFF  — Node/TS, Express 5, :3000         storefront/src/server.ts
   │  fetch http://localhost:4000/v1/*  (PLATFORM_URL)
   │  + stub payment provider (in-process)           storefront/src/payments.ts
   ▼
 Platform service — Java 17, JDK HttpServer, :4000   platform/src/main/java/platform/
   │  GameRegistry → one GameAdapter per game
   │  GameClient (java.net.http, 2 s timeout)
   ▼
 Game backends — Java, JDK HttpServer, one JVM       games/src/main/java/games/
   :4101 Nova Arena  :4102 Tide Farm  :4103 Iron Siege  :4104 Drift Club
```

- All calls are synchronous HTTP/JSON. There are no queues, databases or
  background workers in the platform or storefront.
- **All state is in memory** (ConcurrentHashMaps), per process. A restart wipes
  orders (platform) and grants/inventory (games).
- **Source of truth for ownership** is the game (its grants/inventory), not the
  platform. The platform's order record is its own view.
- The only background activity anywhere: Drift Club's single-thread scheduler
  that settles grants after 1.5 s, plus browser-side polling in the UI.

### Build and run

- Gradle multi-project (`settings.gradle.kts`: `platform`, `games`). Root
  `build.gradle.kts` sets `options.release = 17`, Jackson 2.18.1, and JUnit 5.11.
  The Gradle wrapper is 9.8.1. Both subprojects use the `application` plugin.
- `start.sh` / `start.ps1` check Java ≥ 17 and Node, check ports
  3000/4000/4101–4104 are free, run `npm install` once, run
  `./gradlew installDist`, then start games, platform and storefront.
- Running pieces separately: `./gradlew :games:run [--args="nova tide iron drift"]`,
  `./gradlew :platform:run`, `cd storefront && npm start`.
- Env vars: `PREVIEW_GAMES=true` (storefront shows and sells non-live games),
  `PLATFORM_URL` (storefront → platform), `PORT` (storefront),
  `STOREFRONT_URL` (Playwright base URL).

### Tests (as shipped)

- `./gradlew test`: JUnit 5. One example each: `platform/src/test/.../ExampleAdapterTest.java`
  (Nova catalogue parse) and `games/src/test/.../ExampleGameTest.java` (map helper).
- `cd storefront && npm test`: vitest, `tests/unit/**/*.test.ts`. One example: `formatPrice(499,"EUR")`.
- `cd storefront && npm run test:e2e`: Playwright, `tests/e2e/`. Expects the stack running on :3000.
  One example: game tabs render.
- Node: `.nvmrc` = 24, `package.json` engines `>=22`. TypeScript 7, tsx, Express 5.

---

## 3. Documented contracts

### 3.1 Game Integration API v1 (`docs/game-integration-api.md`)

The platform is the only caller. Base path `/game/v1`.

| Endpoint | Documented behaviour |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `GET /players/{id}` | `{playerId, displayName, level}`; `404` + error body if unknown |
| `GET /players/{id}/inventory` | `{playerId, items:[{itemId, quantity}]}`; revoked grants excluded |
| `GET /catalog?playerId=` | `{items:[{itemId, name, priceMinor, currency}]}`; **must filter out items the player is not eligible for** |
| `POST /grants` | Body `{grantId, playerId, itemId, quantity}` → `201` with grant `{…, status:"granted", grantedAt}`. **Idempotent on platform-generated `grantId`**: a replay must not re-deliver and returns `200` with the original. **Synchronous**: a success means delivered. |
| `GET /grants/{id}` | The grant, or `404` |
| `POST /grants/{id}/revoke` | `200` `{status:"revoked"}`. **Required**: a refunded player must not keep the item. |

- Item IDs: lowercase `snake_case`, stable. Prices: integer `priceMinor` and an ISO 4217 `currency`.
- Errors: `{"error":"code"}` with `400` malformed / `404` not found / `422`
  cannot fulfil / `5xx` game failed (platform may retry). `2xx` means success.
- Timing: the platform allows **2 s per call** before it gives up and retries.
- Go-live gate: game team confirms the endpoints, and the platform runs one purchase
  in non-prod. There is no automated readiness check (handover notes).

### 3.2 Platform API (`docs/platform-api.md`), base `http://localhost:4000`

| Endpoint | Documented behaviour |
|---|---|
| `GET /v1/games` | `{games:[{gameId, displayName, live}]}` |
| `GET /v1/games/{gameId}/offers?playerId=` | `{gameId, offers:[{gameId, offerId, gameItemId, name, priceMinor, currency}]}`, normalised |
| `POST /v1/orders` | Body `{gameId, playerId, offerId, idempotencyKey}` → `201` order. Same key returns the original order. `X-Platform-Preview: true` allows non-live games. Errors `403 game_not_live`, `404 unknown_game`, `404 offer_not_found`, `400 missing_field`. |
| `GET /v1/orders/{orderId}` | Order `{orderId, gameId, playerId, offerId, priceMinor, currency, status, grantId, failureReason, createdAt, updatedAt}`. `status` ∈ `pending, delivered, failed, refunded`. |
| `GET /v1/players/{playerId}/orders` | Newest first |
| `GET /v1/games/{gameId}/players/{playerId}/inventory` | Pass-through `{gameId, status, body}` of the game's response, not normalised |
| `POST /v1/orders/{orderId}/refund` | Refund, and ask the game to revoke |

Also implemented but undocumented: `GET /v1/health`, CORS preflight (`OPTIONS`,
`Access-Control-Allow-Origin: *`).

---

## 4. Platform service internals (`platform/src/main/java/platform/`)

| File | Role |
|---|---|
| `PlatformMain.java` | Wires the components, registers HTTP contexts on :4000, parses requests, maps `OrderRejected` → status/error JSON. Routing uses path prefix/suffix matching (`Http.segmentAfter`, `pathEndsWith`). |
| `GameRegistry.java` | Ordered map `gameId → GameAdapter`. Default constructor registers the 4 adapters. A list constructor exists for tests. |
| `GameClient.java` | `java.net.http.HttpClient`, connect timeout 2 s, request timeout 2 s (`REQUEST_TIMEOUT`). Returns `Response(status, JsonNode)`; a non-JSON or empty body becomes `MissingNode`. Timeouts and connection errors are **thrown**. |
| `CatalogService.java` | `offersFor(game, player)`: GET `/game/v1/catalog?playerId=…` (playerId not URL-encoded) → `adapter.parseCatalog`. An unknown game, **any exception, or a non-200 → empty list** (HTTP 200 to the caller). `findOffer` = `offersFor` + match on `offerId`. |
| `OrderService.java` | Order lifecycle (below). In-memory `ordersById`, `ordersByIdempotencyKey`. |
| `Models.java` | `Offer` record, `OrderStatus` enum, mutable `Order` (volatile status/grantId/failureReason/updatedAt), `GrantOutcome` (`granted` / `pending` / `failed`). |
| `Http.java` | JDK `HttpServer` helpers, 16-thread pool, Jackson `MAPPER`, `map(k,v,…)` helper. |
| `adapters/GameAdapter.java` | Interface: `gameId, displayName, baseUrl, live, parseCatalog, parseGrant, parseRevoke`. Default `toOfferId(gameItemId) = gameItemId.toLowerCase()` (no trim). |
| `adapters/*Adapter.java` | Per-game translation (section 5). Base URLs and `live` flags are hard-coded. |

### 4.1 Order flow: `POST /v1/orders` → `OrderService.createOrder` (`OrderService.java:47`)

1. Unknown game → `404 unknown_game`. Not live and no preview header → `403 game_not_live`.
2. Idempotency lookup by `idempotencyKey`. A hit returns the stored order as-is
   (the HTTP handler still answers `201`). The check-then-put is not atomic.
3. `catalog.findOffer` re-fetches the game catalogue live. A miss (including
   any catalogue failure) → `404 offer_not_found`.
4. Create `Order` (status `PENDING`, id `ord_` + 12 chars of a UUID) and store it.
5. `deliver()` (`OrderService.java:78`):
   - Up to `DELIVERY_ATTEMPTS = 2`. **Each attempt generates a new random
     `grantId`.** `quantity` is always 1.
   - POST `/game/v1/grants` → `adapter.parseGrant(status, body, grantId)` →
     `break`. Any HTTP response, including 4xx/5xx, ends the loop. **Only a
     thrown exception (timeout or connection failure) triggers attempt 2.**
   - Both attempts throw → `failed(0, "delivery_transport_error")`.
   - Outcome mapping: `granted` → `DELIVERED`; `pending` → `PENDING` (never
     revisited; nothing polls `GET /grants/{id}`); else `FAILED` + `failureReason`.
   - `order.grantId` = outcome grantId (the game-returned id when present; `null` on failure).
6. Respond `201` with the order, whatever the final status.

### 4.2 Refund flow: `POST /v1/orders/{id}/refund` → `OrderService.refund` (`OrderService.java:109`)

- Unknown order → `404 order_not_found`.
- POST `/game/v1/grants/{order.grantId}/revoke` with body `{}`. The **response
  is not inspected** (`adapter.parseRevoke` is never called). Exceptions are
  swallowed (a code comment says a "finance batch job" retries; no such job
  exists in this repo).
- **Unconditionally** sets `REFUNDED`, regardless of prior status (also for
  `FAILED` / `PENDING` orders, whose `grantId` may be `null` → path `/grants/null/revoke`).
  There is no check against refunding twice.

### 4.3 Inventory pass-through

`GET /v1/games/{g}/players/{p}/inventory` → GET the game's `/players/{p}/inventory`
→ `200 {gameId, status: <game status>, body: <game body>}`. Unreachable game → `502 game_unreachable`.

---

## 5. Game backends: actual behaviour vs. contract

All four games share `games/Http.java` (8-thread pool, no CORS) and are booted
by `GamesMain` (args `nova tide iron drift` choose a subset). Each keeps players,
grants and catalog in memory. Inventory is derived from grants with `status == "granted"`.

### 5.1 Per-game summary

**Nova Arena** (`games/NovaArena.java`): follows the contract.
- Catalog: `gems_small` 499, `gems_large` 1999, `battle_pass` 999 (EUR, `priceMinor`). No eligibility rules.
- Unknown player → `404 player_not_found`.
- Grants: idempotent on `grantId` (replay → `200` + original). `201` on create. Unknown item → `422`.
- Revoke: sets `revoked` and excludes it from inventory. Inventory shape matches the doc.

**Tide Farm** (`games/TideFarm.java`): legacy economy service shapes.
- Catalog item IDs are **UPPERCASE** (`GEMS_SMALL`, `GEMS_LARGE`, `HARVEST_PASS`,
  `GOLDEN_TRACTOR`). Price is a **decimal string** in `price` (no `priceMinor`).
  Items carry `minLevel` (1, 1, 10, 25).
- Catalog is **not filtered by eligibility** (comment: "level gating is enforced at grant time").
- **Errors are often HTTP 200 with `{"error":…}`**: unknown player (player,
  catalog, inventory, grant), unknown grant on GET/revoke, and **`out_of_stock`**.
- Grant: replay with the same `grantId` → **`201`** (not 200) + original. Level too low → `422 level_too_low`.
  `GOLDEN_TRACTOR` stock = **2** per process (AtomicInteger). Exhausted → `200 {"error":"out_of_stock"}`.
- Revoke works within **24 h** of `grantedAt`. After that → `422 revoke_window_expired`.
- Inventory shape differs: `{playerId, inventory:[{itemId, count}]}` instead of `items` / `quantity`.

**Iron Siege** (`games/IronSiege.java`): degraded shared infra.
- Every player/catalog/grant call goes through `degraded()`: sleeps 40–220 ms,
  or **2200–2900 ms 10% of the time** (above the platform's 2 s timeout),
  then returns **`503` 8% of the time**. The inventory route skips `degraded()`.
  The sleep happens *before* the request is processed, so a request the
  platform has timed out on is still carried out afterwards.
- Catalog: price is a **double** in `price` (4.99, 19.99, 9.99) + `currency` EUR.
  Item `"gems_large "` has a **trailing space**. Others: `gems_small`, `siege_pass`.
- Unknown player → **`500 internal_error`** (not 404), on every route.
- Grant: **ignores the request `grantId`**. It mints a fresh UUID on every call,
  so there is **no idempotency**. Item match uses `trim()`. `201` on create.
- **Revoke route does not exist** → `404 not_found` for every revoke.
- Inventory shape matches the doc.

**Drift Club** (`games/DriftClub.java`): queue-backed, not live.
- Catalog item IDs are **dot-separated** (`gems.small`, `gems.large`,
  `drift.pass`, `vip.lounge`). `priceMinor` is present but **no `currency` field**
  (the handover notes say the economy is USD). `vip.lounge` is listed but **not
  grantable** ("progression-awarded").
- Error envelope differs: `{"errors":[{"code":"…","detail":"…"}]}` with
  UPPERCASE codes. Unknown player/grant → **`400`** (not 404). `p-1003` is unknown here.
- Grant: returns **`202` with `status:"pending"`**. It becomes `granted` after
  **1.5 s** on a background scheduler. Duplicate `grantId` → **`409 AWARD_EXISTS`**
  (not 200). `vip.lounge` → `422 ITEM_NOT_GRANTABLE`. Unknown item → `422 ITEM_UNKNOWN`.
- Revoke: returns `200 {status:"revoked"}` but **changes nothing**. The grant stays
  `granted` and stays in inventory ("handled by the club support tooling").
- Inventory: only settled (`granted`) grants. Pending ones are not shown.

### 5.2 Contract conformance matrix (observed)

| Contract point | Nova | Tide | Iron | Drift |
|---|---|---|---|---|
| Unknown player → 404 | ✔ | ✘ 200+error | ✘ 500 | ✘ 400 |
| Error body `{"error":code}` | ✔ | ✔ (but often with 200) | ✔ | ✘ `errors[]` envelope |
| Catalog `priceMinor` int + `currency` | ✔ | ✘ decimal string `price` | ✘ double `price` | ✘ no `currency` |
| Item IDs lowercase snake_case | ✔ | ✘ UPPERCASE | ✘ one has trailing space | ✘ dotted |
| Catalog filtered by eligibility | n/a | ✘ (minLevel) | n/a | ✘ (`vip.lounge`) |
| Grant `201`, synchronous | ✔ | ✔ / ✘ out_of_stock is 200 | ✔ (but may exceed 2 s) | ✘ `202` async |
| Grant idempotent on `grantId`, replay `200` | ✔ | ~ idempotent, replay `201` | ✘ none | ~ rejects replay `409` |
| Revoke works, excluded from inventory | ✔ | ~ only within 24 h | ✘ 404 | ✘ no-op ack |
| Inventory shape `items[{itemId,quantity}]` | ✔ | ✘ `inventory[{itemId,count}]` | ✔ | ✔ |
| Responds within 2 s | ✔ | ✔ | ✘ ~10% slower | ✔ |
| Reliability | ✔ | ✔ | ✘ ~8% 503 | ✔ |

### 5.3 Adapter handling of these differences (`platform/.../adapters/`)

| Adapter | Catalog parsing | Grant parsing | Revoke parsing (unused) |
|---|---|---|---|
| Nova | `priceMinor`, `currency` | 200/201 → granted, else failed(`error`) | 200 → revoked |
| Tide | `BigDecimal(price).movePointRight(2).longValueExact()`. `offerId` = lowercased id, `gameItemId` = original UPPERCASE id | **200/201 → granted** (a 200 with `error` body, e.g. `out_of_stock`, counts as granted) | 200 → revoked (a 200 with error body also counts) |
| Iron | `(long)(price * 100)`: **truncates**, so 19.99 → **1998**. `offerId` keeps the trailing space | 200/201 → granted (uses the game's returned grantId); 5xx → failed, not retried | 200 → revoked |
| Drift | `priceMinor`; **currency defaults to `"EUR"`** when absent | 202 → pending; 200/201 → granted; else failed(`errors[0].code`) | 200 → revoked |

---

## 6. Storefront (`storefront/`)

### 6.1 BFF: `src/server.ts` (Express 5, :3000)

| Route | Behaviour |
|---|---|
| `GET /api/games` | Platform `/v1/games`, filtered to `live` unless `PREVIEW_GAMES=true` |
| `GET /api/games/:gameId/offers?playerId=` | Platform offers → `offerView` (`{offerId, name, price}`; the price is a display string and currency is dropped) |
| `POST /api/checkout` | Body `{gameId, playerId, offerId, idempotencyKey, card}`. (1) Re-fetch offers and find the offer, else `404`. (2) `payments.authorise(card, priceMinor, currency)`; declined → `402`. (3) `platform.createOrder(…, previewGames)`. (4) `201 {...orderView, paymentRef}`. Platform errors are passed through with their status. **The payment is authorised before the order and is never voided or refunded on order failure.** |
| `GET /api/orders?playerId=` | Platform orders → `orderView` |
| `GET /api/inventory?gameId=&playerId=` | Platform inventory pass-through |
| `POST /api/orders/:orderId/refund` | Platform refund → `orderView` (no payment-side refund) |
| `GET /api/orders/:orderId` | Platform order → `orderView` |

- `src/platform.ts`: typed fetch client for the platform API. Non-2xx throws
  `Error(body.error)` with `.status` / `.body`.
- `src/payments.ts`: stub provider. 250 ms delay. A card number under 12 digits →
  declined `invalid_card_number`. `4000000000000002` → `card_declined`. Anything
  else → authorised. Returns `pay_…` reference. There is no capture, void or refund.
- `src/view.ts`: presentation helpers, deliberately pure:
  - `formatPrice(priceMinor, _currency)` → **always `€` + priceMinor/100**; the currency is ignored.
  - `statusLabel(order)`: `pending` → "Processing…", `refunded` → "Refunded",
    **everything else (including `failed`) → "Delivered"**.
  - `orderView` → `{orderId, gameId, offerId, price, currency, label, status}`.

### 6.2 Browser UI: `public/`

- `index.html` + `app.js` (store): player selector (p-1001..1003), game tabs
  (non-live tabs labelled "(preview)"), offer list, checkout `<dialog>` with
  prefilled test card `4242 4242 4242 4242`. **`idempotencyKey =
  crypto.randomUUID()` is generated on every Pay click.** On error, it shows
  "Payment failed: <error>". Orders list shows `label` and polls every 2 s.
  `data-testid` attributes throughout (`offer-<id>`, `buy`, `checkout-pay`,
  `order-status`, …). Offer/order IDs are `.trim()`med for display/test IDs.
- `support.html` + `support.js` (internal "support console", linked from the
  store): per player, a table of platform orders (raw `status`, charged
  amount + currency, a **Refund** button with no confirmation) and, per game
  from `/api/games` (so live-only unless preview), the game's raw inventory JSON
  and HTTP status. Refreshes every 4 s. Docs note nobody has checked it against
  what the store believes happened.
- `styles.css`: layout only.

---

## 7. End-to-end purchase sequence (happy path)

```
Browser ──POST /api/checkout {gameId,playerId,offerId,idemKey,card}──▶ BFF
BFF ──GET /v1/games/{g}/offers?playerId──▶ Platform ──GET /game/v1/catalog──▶ Game
BFF ── payments.authorise (250 ms, in-process) ── authorised
BFF ──POST /v1/orders {…, idempotencyKey} [+X-Platform-Preview]──▶ Platform
   Platform: idem lookup → GET catalog again (findOffer) → create Order(PENDING)
   Platform ──POST /game/v1/grants {grantId(new UUID), playerId, itemId=gameItemId, quantity:1}──▶ Game
   Game ──201 grant──▶ Platform: Order → DELIVERED
Platform ──201 order──▶ BFF ──201 {orderView, paymentRef}──▶ Browser
Browser polls GET /api/orders every 2 s
```

A single purchase makes **three** catalogue reads (BFF checkout, platform
`findOffer`, plus the original page load) and one grant call (or two on timeout).

---

## 8. Known-unknowns from the docs

**Handover notes (`docs/handover-notes.md`), open questions:**
- There is no way to say whether an integration is ready, other than turning it on and watching tickets.
- Unknown whether live integrations still match the API doc.
- Refunds use the same path for every game. What actually happens per game is unchecked.

**Support tickets (`docs/support-tickets.md`), all unconfirmed.** The right-hand
column lists the code paths each ticket touches, as an orientation aid. These
links are hypotheses from reading the code and have **not** been reproduced.

| Ticket | Game | Report | Code paths involved |
|---|---|---|---|
| PS-291 | Iron | Error shown, pass later on account, player bought again | Iron Siege >2 s latency vs. 2 s timeout; game completes after the client gives up; platform retry with new grantId; no game-side idempotency; storefront error display; new idempotencyKey per click |
| PS-304 | Nova | Gems on a second account (closed, no fault) | Player selection in UI |
| PS-318 | Iron | "Shop is empty" for ~10 min, self-recovered | `CatalogService` returns empty list on any exception/non-200; Iron Siege 503s/slow calls; UI shows "No offers available." |
| PS-330 | Tide | Harvest Pass (minLevel 10) never arrived, player level 4, order looked fine | Tide catalog not eligibility-filtered; grant `422 level_too_low` → order `failed`; `statusLabel` renders `failed` as "Delivered"; payment already authorised |
| PS-341 | Iron | Purchase hung several seconds, pressed buy again | Iron Siege latency × up to 2 attempts; no in-flight UI state; new idempotencyKey per click |
| PS-349 | — | Layout breaks on narrow phones (won't fix) | `styles.css` |
| PS-358 | Iron | Orders show failed but items arrived (3rd this quarter) | Timeout-then-complete on Iron Siege; both attempts time out → `delivery_transport_error` while game granted |
| PS-366 | Tide | Bought Golden Tractor (stock 2), got nothing, order "delivered", player L40 | Tide `200 {"error":"out_of_stock"}` parsed as granted by `TideFarmAdapter.parseGrant` |

---

## 9. Glossary

- **offerId**: platform identifier for a purchasable item (`toOfferId` = lowercased game item id).
- **gameItemId**: the game's own item id. Sent back in grant requests.
- **grantId**: per-delivery id generated by the platform (per attempt). It is the
  game-side idempotency key in the contract.
- **idempotencyKey**: caller-generated key for `POST /v1/orders` (the storefront
  generates one per Pay click).
- **Preview mode**: `PREVIEW_GAMES=true` on the storefront → sends
  `X-Platform-Preview: true`, allowing orders for non-live games (Drift Club).
- **Live**: hard-coded `live()` flag on each adapter (Drift Club = false).
- **Minor units**: integer cents (`priceMinor`), e.g. 499 = 4.99.
