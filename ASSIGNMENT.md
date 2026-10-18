# Take-home assignment — Quality Engineering Lead, Player Platform

## The situation

You have taken over quality for **Player Store**: a storefront that sells in-game
items across several games.

Each game is built by its own team. They all implement the same integration API
on paper. The platform service sits in the middle and is supposed to make them
look like one consistent product to a player.

Three games are live: **Nova Arena**, **Tide Farm** and **Iron Siege**. A fourth,
**Drift Club**, was integrated two weeks ago and is scheduled to go live at the
end of next week.

Nobody currently working on the team has looked closely at any of this. There are
no tests beyond a couple of examples left in the repo.

## What we would like

**Materially better confidence in this system than we have today**, using the
four hours below.

What that means is your call. You know the constraints; we have not decided the
route for you, and there is no single expected answer.

Work of this kind usually comes out as some mix of:

- automated tests, wherever you think they belong;
- a written account of what you found, in the form you would hand to whoever
  owns the problem;
- tooling that makes something visible that was not visible before;
- fixes, where you think fixing is the right call.

Any mix is fine, and we do not expect all of them.

**A failing test that demonstrates a real problem is a finished piece of work,
not an unfinished one.** You do not have to make anything pass. Fix things if you
decide that is the better use of your time, and tell us why you decided that.

## The repo

Everything runs locally with `./start.sh`. [`README.md`](README.md) covers the
layout, the ports and how to run things.

You may change anything in `storefront/` and `platform/` — that code is yours now.

The four game backends in `games/` belong to other teams. In production they are
somebody else's service on the other side of an API, and you cannot make a change
land in one on your own schedule — so **whatever you build has to work with them
as they are**.

Read them if it helps. If the clearest way to describe a problem is a patch you
would hand to the game team, write one. Just do not spend your afternoon in
there: they are stand-ins, written to behave like the real thing rather than to
be nice code, and nothing here depends on improving them.

Drift Club is not enabled for players, so the store hides it. The README explains
how to reach it anyway, under *Reaching a game that is not live yet*.

## What is written down

**Read all four of these before you start.** They are short, and between them
they are most of what we know about this system.

- [`docs/game-integration-api.md`](docs/game-integration-api.md) — the contract
  every game is supposed to implement. It is what we hand a game team when an
  integration starts.
- [`docs/platform-api.md`](docs/platform-api.md) — what the platform exposes to
  the storefront.
- [`docs/handover-notes.md`](docs/handover-notes.md) — what we were told when
  this work changed hands. Incomplete, and some of it predates the last two
  integrations.
- [`docs/support-tickets.md`](docs/support-tickets.md) — what players and support
  agents have written in about. Unconfirmed, and nobody has reproduced any of it.

## Tools

Use whatever you are fastest in: any language, any test framework.

**Use AI tools if they help — we would rather you did.** We use them ourselves,
and four hours is not long. The only thing we ask is that you can stand behind
what you send: we will go through it with you afterwards and ask how parts of it
work and why you went that way.

The repo happens to come with JUnit, vitest and Playwright installed, each with
one example test, so that nobody has to spend their afternoon wiring up a runner.
That is convenience, not a recommendation. We do not score the choice. If you
would rather work in pytest, Rest Assured, k6, plain `curl` or something we have
not thought of, do that — it costs you nothing with us.

## Timebox

**Four hours**, and the clock is for the work, not the setup.

Before you start counting:

- install the prerequisites and get `./start.sh` running;
- open <http://localhost:3000> and buy something, so you know the stack is up;
- not required, but a good idea: put the untouched repo under version control
  first — `git init`, add everything, commit, or whatever you normally use.
  Otherwise your changes are hard to pick out from the code we gave you.

Setting up an environment is not what we are testing. The README lists what you
need; if that part fights you, tell us — that is a bug in our kit rather than a
problem with you.

We would rather see what you chose to do in four hours than a complete-looking
submission that took twelve. If you run out of time mid-thought, say so in your
notes — that is useful signal, not a failure.

## What to send back

1. **Your code**, and how to run it. If you committed as you went, send the
   repository with its history rather than a flattened copy.
2. **About a page of notes** covering:
   - what you went after, and what you found;
   - what you deliberately did not do, and why;
   - what you would do next with more time.
3. **A line on AI use.** Briefly, how and where you used it. We ask so we know
   what we are reading, not to score it.

No slides and no strategy document. We are interested in the decisions, and the
decisions should be visible in the work.

## Afterwards

We will go through the submission with you. That conversation is where you get to
explain your reasoning, walk us through what you built, and tell us about the
paths you considered and rejected — so do not try to write all of that down now.

Expect us to ask why you made particular calls, and to introduce a constraint or
two you did not have on the day.
