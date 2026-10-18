const playerSelect = document.getElementById("player");
const gamesNav = document.getElementById("games");
const offersList = document.getElementById("offers");
const ordersList = document.getElementById("orders");

let games = [];
let selectedGameId = null;

const playerId = () => playerSelect.value;

async function loadGames() {
  const response = await fetch("/api/games");
  games = (await response.json()).games;
  selectedGameId = selectedGameId ?? games[0]?.gameId ?? null;
  renderGames();
}

function renderGames() {
  gamesNav.replaceChildren(
    ...games.map((game) => {
      const button = document.createElement("button");
      button.textContent = game.live ? game.displayName : `${game.displayName} (preview)`;
      button.dataset.testid = `game-${game.gameId}`;
      button.setAttribute("aria-selected", String(game.gameId === selectedGameId));
      button.addEventListener("click", () => {
        selectedGameId = game.gameId;
        renderGames();
        loadOffers();
      });
      return button;
    })
  );
}

async function loadOffers() {
  if (!selectedGameId) return;
  const response = await fetch(
    `/api/games/${selectedGameId}/offers?playerId=${encodeURIComponent(playerId())}`
  );
  const { offers } = await response.json();

  if (!offers.length) {
    offersList.replaceChildren(row("No offers available.", "empty"));
    return;
  }

  offersList.replaceChildren(
    ...offers.map((offer) => {
      const item = document.createElement("li");
      item.dataset.testid = `offer-${offer.offerId.trim()}`;

      const label = document.createElement("span");
      label.textContent = offer.name;

      const price = document.createElement("span");
      price.className = "price";
      price.dataset.testid = "offer-price";
      price.textContent = offer.price;

      const buy = document.createElement("button");
      buy.className = "buy";
      buy.dataset.testid = "buy";
      buy.textContent = "Buy";
      buy.addEventListener("click", () => openCheckout(offer));

      item.append(label, price, buy);
      return item;
    })
  );
}

const dialog = document.getElementById("checkout");
const checkoutError = dialog.querySelector('[data-testid="checkout-error"]');
let pendingOffer = null;

function openCheckout(offer) {
  pendingOffer = offer;
  dialog.querySelector('[data-testid="checkout-item"]').textContent = offer.name;
  dialog.querySelector('[data-testid="checkout-price"]').textContent = offer.price;
  checkoutError.hidden = true;
  checkoutError.textContent = "";
  dialog.showModal();
}

function card() {
  const value = (name) => dialog.querySelector(`[data-testid="card-${name}"]`).value;
  return {
    name: value("name"),
    number: value("number"),
    expiry: value("expiry"),
    cvc: value("cvc"),
  };
}

async function pay() {
  const response = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gameId: selectedGameId,
      playerId: playerId(),
      offerId: pendingOffer.offerId,
      idempotencyKey: crypto.randomUUID(),
      card: card(),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    checkoutError.textContent = `Payment failed: ${body.error ?? response.status}`;
    checkoutError.hidden = false;
    return;
  }

  dialog.close();
  await loadOrders();
}

dialog
  .querySelector('[data-testid="checkout-pay"]')
  .addEventListener("click", pay);
dialog
  .querySelector('[data-testid="checkout-cancel"]')
  .addEventListener("click", () => dialog.close());

async function loadOrders() {
  const response = await fetch(`/api/orders?playerId=${encodeURIComponent(playerId())}`);
  const { orders } = await response.json();

  if (!orders.length) {
    ordersList.replaceChildren(row("Nothing purchased yet.", "empty"));
    return;
  }

  ordersList.replaceChildren(
    ...orders.map((order) => {
      const item = document.createElement("li");
      item.dataset.testid = `order-${order.orderId}`;

      const label = document.createElement("span");
      label.textContent = `${order.gameId} · ${order.offerId.trim()}`;

      const price = document.createElement("span");
      price.className = "price";
      price.textContent = order.price;

      const status = document.createElement("span");
      status.className = "status";
      status.dataset.testid = "order-status";
      status.textContent = order.label;

      item.append(label, price, status);
      return item;
    })
  );
}

function row(text, className) {
  const item = document.createElement("li");
  item.className = className;
  item.textContent = text;
  return item;
}

playerSelect.addEventListener("change", () => {
  loadOffers();
  loadOrders();
});

await loadGames();
await loadOffers();
await loadOrders();

// Keep in-flight purchases up to date.
setInterval(loadOrders, 2000);
