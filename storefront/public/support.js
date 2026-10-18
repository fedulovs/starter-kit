const playerSelect = document.getElementById("player");
const ordersBody = document.getElementById("orders");
const inventories = document.getElementById("inventories");

const playerId = () => playerSelect.value;

async function loadOrders() {
  const response = await fetch(`/api/orders?playerId=${encodeURIComponent(playerId())}`);
  const { orders } = await response.json();

  ordersBody.replaceChildren(
    ...orders.map((order) => {
      const row = document.createElement("tr");
      row.dataset.testid = `order-${order.orderId}`;

      const cell = (text, testid) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (testid) td.dataset.testid = testid;
        return td;
      };

      const action = document.createElement("td");
      const refund = document.createElement("button");
      refund.textContent = "Refund";
      refund.dataset.testid = "refund";
      refund.addEventListener("click", async () => {
        await fetch(`/api/orders/${order.orderId}/refund`, { method: "POST" });
        await refresh();
      });
      action.append(refund);

      row.append(
        cell(order.orderId),
        cell(order.gameId),
        cell(order.offerId.trim()),
        cell(`${order.price} (${order.currency})`, "order-charged"),
        cell(order.status, "order-status"),
        action
      );
      return row;
    })
  );

  if (!orders.length) {
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "empty";
    td.textContent = "No orders for this player.";
    row.append(td);
    ordersBody.replaceChildren(row);
  }
}

async function loadInventories() {
  const { games } = await (await fetch("/api/games")).json();

  const blocks = await Promise.all(
    games.map(async (game) => {
      const response = await fetch(
        `/api/inventory?gameId=${game.gameId}&playerId=${encodeURIComponent(playerId())}`
      );
      const payload = await response.json().catch(() => ({ error: "unreadable" }));

      const block = document.createElement("div");
      block.className = "inventory";
      block.dataset.testid = `inventory-${game.gameId}`;

      const title = document.createElement("h3");
      title.textContent = `${game.displayName} — HTTP ${payload.status ?? "?"}`;

      const body = document.createElement("pre");
      body.textContent = JSON.stringify(payload.body ?? payload, null, 2);

      block.append(title, body);
      return block;
    })
  );

  inventories.replaceChildren(...blocks);
}

async function refresh() {
  await Promise.all([loadOrders(), loadInventories()]);
}

playerSelect.addEventListener("change", refresh);
await refresh();
setInterval(refresh, 4000);
