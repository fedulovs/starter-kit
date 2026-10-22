# Notes

## What I went after

The handover notes leave two questions open that matter most here: is an
integration ready for its release next week, and do the live games still
follow the API doc? I went after those, plus the support tickets nobody had
reproduced.

### 1. Understand the system

The first thing I did was build an understanding of how the system works, and
document it so that AI agents can use it later.
Output: [architecture reference](architecture.md).

### 2. Analyse the support tickets

Next I analysed the support tickets. They list the errors players already face,
which shows where the system is flawed today. I categorised the tickets by
failure type, game, severity and where the fix lives, then reproduced them
against the running stack using Claude.
Output: [triage document](support-tickets-triage.md).

### 3. Prioritise

I prioritised the issues using Claude and my own judgement, and came up with
the plan below.

### 4. Plan

Given the time limit, and the marketing-bound release next week, I planned three
Playwright suites and a results table (one runner, one report):

- **Game contract suite (C1–C14 × 4 games).** Each rule in
  `game-integration-api.md` is a test, run against every game directly. This is
  the readiness check the handover says is missing.
- **Store ↔ game agreement suite (I1–I10).** Orders, refunds and prices go
  through the platform, then each game is asked what the player actually owns.
  This tests the code we own: whether the platform absorbs the games'
  inconsistencies or turns them into lost items, kept refunds and wrong prices.
- **UI smoke suite (U1–U7).** The main purchase and refund flows in a real
  browser. The baseline flows pass, which shows the harness works, so the red
  tests point at the system, not the tests.
- **A results table** (`npm run report`): game × rule ✔/✘, with the game's
  actual response as the reason for each failure. Snapshot:
  [test-results.md](test-results.md).

### 5. Implementation

I used Claude to draft the implementation, then checked it myself and fixed the
places where the output was inconsistent. I ran all three suites manually before
the changes were code-reviewed by a separate agent. In a real team, this would
be backed by human code review.

## What I found

- **Only Nova Arena follows the contract (14/14).** Tide Farm and Iron Siege
  meet 6/14, Drift Club 4/14.
- **Iron Siege gives items away.** It ignores the grant ID, so it has no
  idempotency, and it finishes requests after the platform has given up at 2 s.
  The platform also sends a new grant ID on each retry. In one run, 60 orders
  produced 58 grants for 47 delivered orders. This explains PS-291, PS-341 and
  PS-358. PS-358 should not be closed: the agreement suite caught an order
  reported `failed` while two items arrived (I2), and more items than delivered
  orders (I3).
- **Refunds don't take the item back on Iron Siege (no revoke route) or Drift
  Club (revoke does nothing).** The platform ignores the revoke response and
  marks the order `refunded` anyway. It also refunds orders that were never
  delivered, and refunds the same order twice. No player will ever report this.
- **The store tells players the wrong thing.** A failed order is shown as
  "Delivered" (PS-330). Tide Farm's sold-out tractor reports HTTP 200 with an
  error and is recorded as delivered (PS-366). Double-clicking Pay creates two
  orders. Every price is shown in euros.
- **"Shop is empty" (PS-318) is the platform hiding Iron Siege errors** as an
  empty offer list: 17–40% of offer loads across my runs.
- **Drift Club is not ready for its fixed go-live date.** Grants are async (202)
  and orders stay `pending` forever. Refunds do nothing. Its currency is unknown
  (the handover says USD; the platform labels it EUR). One listed item can never
  be delivered.

## What I deliberately did not do

- **No fixes.** A failing test that names the defect is a finished piece of
  work, and fixing first would have hidden what the system does today.
  Candidate fixes in our code are listed in [fixes-list.md](fixes-list.md). Several are
  one-liners.
- **No load or concurrency testing** beyond sampling Iron Siege's latency.

## What I would do next

1. Take the findings to their owners before release. Each game team gets its    failing contract rows as evidence; the release owner gets the list of Drift Club blockers. Then agree a plan to bring every game onto the contract, with the contract suite as the readiness check.
2. Make the contract suite the go-live gate for Drift Club, and send each game
   team its failing rows.
3. Apply the cheap fixes (F1 status label, F3 Tide error parsing, F4 Iron price
   rounding), then F5/F6 (stable grant ID, honest refunds), keeping the tests
   as regression checks.

## AI use

I used Claude Code to summarise the docs and architecture, reproduce the tickets
against the running stack, draft the test suites from my plan, create the report
script, and review the code (with a separate agent). I made the plan, chose what
to test, reviewed and fixed the output, and checked that every failing test
fails for the reason it states.
