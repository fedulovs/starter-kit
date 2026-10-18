# Handover notes

Written up when the integration work moved teams. Incomplete, and some of it
predates the last two integrations.

---

**Nova Arena** was the first integration and the API doc was largely written
against it. It has been quiet in production for a long time.

**Tide Farm** sits on top of the team's own economy service, which is older than
our integration and was not built for it. Their side of the work was mostly
translation. Tide Farm also runs limited-run items — Golden Tractor is capped for
the season — which no other game does yet.

**Iron Siege** went in fast for a seasonal campaign and the people who built it
have moved on. It runs on shared infrastructure that sheds load, so occasional
5xx responses and slow calls are expected rather than exceptional. Support has
raised a few tickets about Iron Siege purchases over the last months; nothing was
ever reproduced. There is an export of the queue in
[`support-tickets.md`](support-tickets.md).

**Drift Club** was integrated two weeks ago and is not enabled for players yet.
It is planned to go live at the end of next week alongside a marketing beat, so
the date is not easy to move.

Two things we know about Drift Club:

- Their inventory service is queue-backed rather than inline.
- Their economy is denominated in **USD**, unlike the other three.

Nobody has looked at Drift Club properly since the integration was written.

---

Open questions we never got to:

- We do not have a way to say whether an integration is ready, other than turning
  it on and watching support tickets.
- We do not know whether the live integrations still behave the way the API doc
  says they do.
- Refunds go through the same path for every game and we have not checked what
  actually happens on each one.
