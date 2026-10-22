# Player Store — starter kit

**Start with [ASSIGNMENT.md](ASSIGNMENT.md).** This file is just how to run things.

A storefront that sells in-game items, a platform service that fronts every game
integration, and four game backends that each implement the same integration API
in their own way.

## Running it

Prerequisites: **any JDK 17 or newer**, and **Node 22 or newer**. Nothing else —
Gradle and the npm packages are fetched on first run.

### Installing those

**Node.** [nvm](https://github.com/nvm-sh/nvm) is the least painful route, and
there is an `.nvmrc` here, so from the repo root:

```bash
nvm install   # reads .nvmrc
nvm use
```

Or [fnm](https://github.com/Schniz/fnm), `brew install node`, or the installer
from [nodejs.org](https://nodejs.org). On Windows,
[nvm-windows](https://github.com/coreybutler/nvm-windows) or
`winget install OpenJS.NodeJS.LTS`.

**JDK.** Any 17 or newer; [Temurin](https://adoptium.net) is a safe default.

```bash
brew install --cask temurin                      # macOS
sudo apt install openjdk-21-jdk                  # Debian/Ubuntu
winget install EclipseAdoptium.Temurin.21.JDK    # Windows
```

[SDKMAN](https://sdkman.io) is worth having if you juggle several JDKs.

macOS and Linux:

```bash
./start.sh
```

Windows (PowerShell):

```powershell
.\start.ps1
```

Either one checks the prerequisites, installs the storefront dependencies the
first time, builds the Java services and starts everything.

**Then open <http://localhost:3000> — that is the store.** Ctrl-C stops
everything.

The rest of the stack runs behind it:

| Service        | URL                     | Notes                          |
|----------------|-------------------------|--------------------------------|
| Storefront     | http://localhost:3000   | Web UI and its backend-for-frontend |
| Platform API   | http://localhost:4000   | One API in front of every game |
| Nova Arena     | http://localhost:4101   | Live                           |
| Tide Farm      | http://localhost:4102   | Live                           |
| Iron Siege     | http://localhost:4103   | Live                           |
| Drift Club     | http://localhost:4104   | Integrated, not yet enabled    |

First run downloads Gradle and npm dependencies. After that it works offline.

To run pieces separately, in three terminals. On Windows use `gradlew.bat` in
place of `./gradlew`; everything else is the same.

```bash
./gradlew :games:run                    # all four games
./gradlew :games:run --args="nova tide" # just some of them
./gradlew :platform:run                 # the platform service
cd storefront && npm install && npm start
```

## Read these first

- [`ASSIGNMENT.md`](ASSIGNMENT.md) — what we are asking you to do
- [`docs/game-integration-api.md`](docs/game-integration-api.md) — the contract every game is supposed to implement
- [`docs/platform-api.md`](docs/platform-api.md) — the platform's own API
- [`docs/handover-notes.md`](docs/handover-notes.md) — what we were told when this work changed hands
- [`docs/support-tickets.md`](docs/support-tickets.md) — unconfirmed reports from players and support

They are short. Between them they are most of what is known about this system.

## Layout

```
storefront/   TypeScript. Web UI (public/) and its BFF (src/server.ts).
platform/     Java. The service every storefront request goes through.
              platform/adapters/ translates each game's API into platform terms.
games/        Java. The four game backends. Independently written, by design.
docs/         The integration contract, the platform API, and the
              handover notes. Start here.
claude/       What this submission found: notes, ticket triage, architecture
              reference, candidate fixes, and a snapshot of the test results.
storefront/tests/     The Playwright suites (api/, e2e/) and their helpers (support/).
storefront/scripts/   results-table.mjs, which turns a test run into the results table.
```

## Findings

Start with [`claude/notes.md`](claude/notes.md), the one-page summary. The rest
backs it up:

- [`claude/test-results.md`](claude/test-results.md): game × rule ✔/✘ table from one full run, with the reason for every failure
- [`claude/support-tickets-triage.md`](claude/support-tickets-triage.md): the tickets grouped by failure type, with reproductions
- [`claude/fixes-list.md`](claude/fixes-list.md): candidate fixes in the code we own (none applied)
- [`claude/architecture.md`](claude/architecture.md): how the system works, and where each game departs from the contract

## Tests

Each layer has a test setup that already runs, with one example test in it. The
examples exist so you do not have to spend your time on wiring; they are not a
suggestion about where tests belong.

```bash
./gradlew test                          # Java, JUnit 5 (platform + games)
cd storefront && npm test               # TypeScript, vitest
cd storefront && npx playwright install chromium   # once
cd storefront && npm run test:e2e       # all Playwright suites below (API + browser)
```

Use these, replace them, or ignore them and bring your own tooling.

### Quality suites: contract, agreement and UI

Three Playwright suites in `storefront/tests/`, run against the live stack:

| Suite | What it checks | Where |
|---|---|---|
| Game contract (`api` project, `@contract`) | Each of the 14 rules in `docs/game-integration-api.md`, run against every game directly (C1–C14) | `tests/api/game-contract.spec.ts` |
| Store ↔ game agreement (`api` project, `@invariant`) | Orders, refunds and prices placed through the platform, then checked against what each game actually holds (I1–I10) | `tests/api/store-game-agreement.spec.ts` |
| UI smoke (`ui` project) | Buying, a declined card, double-clicking Pay, and refunds from the support console, in a real browser (U1–U7) | `tests/e2e/` |

Red tests are expected: each failing test records a real defect and fixes
nothing. A preflight check fails fast if the stack is not running.

```bash
./start.sh                              # in one terminal; restart it for a clean slate
cd storefront
npx playwright install chromium         # once
npm run test:report                     # all three suites, then the results table (~6 min)
npm run test:contract                   # just the game contract suite
npm run test:invariant                  # just the store ↔ game agreement suite
npm run test:ui                         # just the browser suite
npm run report                          # rebuild the table from the last run
```

`npm run report` writes a game × rule ✔/✘ table, with the reason for each
failure, to `storefront/test-results/results.md`. It covers **only the last
Playwright run**, so after running one suite on its own the table shows just
that suite; use `npm run test:report` for the full picture. The HTML report with
traces is in `storefront/playwright-report/` (`npx playwright show-report`). A
snapshot of one full run is in [`claude/test-results.md`](claude/test-results.md).

Notes:

- All state is in memory and shared with the tests. Tests measure before/after
  differences, so repeated runs give the same verdicts (apart from Iron Siege's
  random behaviour, below). Restart the stack if
  you want empty inventories (C6 uses up Tide Farm's two Golden Tractors).
- Iron Siege randomly sheds load. Contract tests repeat a call that answers
  503, except C14, which measures slowness on purpose. C14 fails on most runs,
  not all. The agreement suite runs Iron Siege over a batch of 60 orders and
  asserts rules that must hold for every order. I3 and I9 fail reliably; I2
  needs a rare combination and is caught on some runs only.
- The agreement suite takes 3–4 minutes, mostly Iron Siege's batch.
- U7 needs preview mode and is skipped otherwise. To run it without restarting
  the main stack, start a second storefront in another terminal, from
  `storefront/`: `PORT=3100 PREVIEW_GAMES=true npm start`. Then, also from
  `storefront/`: `STOREFRONT_URL=http://localhost:3100 npm run test:ui -- --grep @preview`.
  Stop the second storefront with Ctrl-C in its terminal.

## Players

The same three players exist across the games:

| Player  | Name | Level |
|---------|------|-------|
| p-1001  | Aino | 12    |
| p-1002  | Bo   | 3     |
| p-1003  | Cleo | 40    |

## Reaching a game that is not live yet

Drift Club is integrated but not enabled for players, so the store hides it and
the platform refuses orders for it.

To work with it anyway, turn on preview mode:

```bash
PREVIEW_GAMES=true ./start.sh
```

Non-live games then show up in the store marked `(preview)` and can be bought
like any other. Underneath, the storefront is sending `X-Platform-Preview: true`,
which you can also do yourself:

```bash
curl -X POST http://localhost:4000/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'X-Platform-Preview: true' \
  -d '{"gameId":"drift-club","playerId":"p-1001","offerId":"gems.small","idempotencyKey":"demo-1"}'
```

## State

All state is in memory, in each service. Restart one and it resets.

What a player actually owns lives in the game, not in the platform. Each game
exposes it at `GET /game/v1/players/{playerId}/inventory` — see
[`docs/game-integration-api.md`](docs/game-integration-api.md).
