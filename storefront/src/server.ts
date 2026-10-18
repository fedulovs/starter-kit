import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as platform from "./platform.js";
import * as payments from "./payments.js";
import { offerView, orderView } from "./view.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = express();

/**
 * Show games that are integrated but not enabled for players yet, and let them
 * be bought. Off by default. Start with PREVIEW_GAMES=true to turn it on.
 */
const previewGames = process.env.PREVIEW_GAMES === "true";

app.use(express.json());
app.use(express.static(join(here, "..", "public")));

/** Games a player can actually buy from. */
app.get("/api/games", async (_req, res) => {
  try {
    const { games } = await platform.listGames();
    res.json({ games: previewGames ? games : games.filter((game) => game.live) });
  } catch (error) {
    res.status(502).json({ error: "platform_unavailable" });
  }
});

app.get("/api/games/:gameId/offers", async (req, res) => {
  const playerId = String(req.query.playerId ?? "");
  try {
    const { offers } = await platform.listOffers(req.params.gameId, playerId);
    res.json({ offers: offers.map(offerView) });
  } catch (error) {
    res.status(502).json({ error: "platform_unavailable" });
  }
});

app.post("/api/checkout", async (req, res) => {
  const { gameId, playerId, offerId, idempotencyKey, card } = req.body ?? {};
  try {
    const { offers } = await platform.listOffers(gameId, playerId);
    const offer = offers.find((candidate) => candidate.offerId === offerId);
    if (!offer) {
      res.status(404).json({ error: "offer_not_found" });
      return;
    }

    const payment = await payments.authorise(card, offer.priceMinor, offer.currency);
    if (payment.status === "declined") {
      res.status(402).json({ error: payment.declineReason ?? "card_declined" });
      return;
    }

    const order = await platform.createOrder(
      { gameId, playerId, offerId, idempotencyKey },
      previewGames
    );
    res.status(201).json({ ...orderView(order), paymentRef: payment.paymentRef });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    res.status(status).json({ error: (error as Error).message });
  }
});

app.get("/api/orders", async (req, res) => {
  const playerId = String(req.query.playerId ?? "");
  try {
    const { orders } = await platform.listOrders(playerId);
    res.json({ orders: orders.map(orderView) });
  } catch (error) {
    res.status(502).json({ error: "platform_unavailable" });
  }
});

/** What the game itself says the player owns, passed through untouched. */
app.get("/api/inventory", async (req, res) => {
  const gameId = String(req.query.gameId ?? "");
  const playerId = String(req.query.playerId ?? "");
  try {
    res.json(await platform.gameInventory(gameId, playerId));
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    res.status(status).json({ error: (error as Error).message });
  }
});

app.post("/api/orders/:orderId/refund", async (req, res) => {
  try {
    res.json(orderView(await platform.refundOrder(req.params.orderId)));
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    res.status(status).json({ error: (error as Error).message });
  }
});

app.get("/api/orders/:orderId", async (req, res) => {
  try {
    res.json(orderView(await platform.getOrder(req.params.orderId)));
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    res.status(status).json({ error: (error as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`STOREFRONT  listening on http://localhost:${port}`);
});
