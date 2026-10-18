package platform;

import platform.Models.GrantOutcome;
import platform.Models.Offer;
import platform.Models.Order;
import platform.Models.OrderStatus;
import platform.adapters.GameAdapter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Creates orders and delivers them into the game that sold them. */
public final class OrderService {

    /** How many times a delivery is attempted when the game does not answer in time. */
    private static final int DELIVERY_ATTEMPTS = 2;

    private final GameRegistry registry;
    private final GameClient client;
    private final CatalogService catalog;

    private final Map<String, Order> ordersById = new ConcurrentHashMap<>();
    private final Map<String, String> ordersByIdempotencyKey = new ConcurrentHashMap<>();

    public OrderService(GameRegistry registry, GameClient client, CatalogService catalog) {
        this.registry = registry;
        this.client = client;
        this.catalog = catalog;
    }

    public static final class OrderRejected extends RuntimeException {
        public final int status;
        public final String code;

        OrderRejected(int status, String code) {
            super(code);
            this.status = status;
            this.code = code;
        }
    }

    public Order createOrder(String gameId, String playerId, String offerId,
                             String idempotencyKey, boolean previewAllowed) {
        GameAdapter adapter = registry.get(gameId);
        if (adapter == null) {
            throw new OrderRejected(404, "unknown_game");
        }
        if (!adapter.live() && !previewAllowed) {
            throw new OrderRejected(403, "game_not_live");
        }

        String existingOrderId = ordersByIdempotencyKey.get(idempotencyKey);
        if (existingOrderId != null) {
            return ordersById.get(existingOrderId);
        }

        Offer offer = catalog.findOffer(gameId, playerId, offerId);
        if (offer == null) {
            throw new OrderRejected(404, "offer_not_found");
        }

        Order order = new Order(
                "ord_" + UUID.randomUUID().toString().substring(0, 12),
                gameId, playerId, offerId, offer.gameItemId(),
                offer.priceMinor(), offer.currency(), idempotencyKey);
        ordersById.put(order.orderId, order);
        ordersByIdempotencyKey.put(idempotencyKey, order.orderId);

        deliver(adapter, order);
        return order;
    }

    private void deliver(GameAdapter adapter, Order order) {
        GrantOutcome outcome = null;

        for (int attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt++) {
            String grantId = UUID.randomUUID().toString();
            Map<String, Object> body = Http.map(
                    "grantId", grantId,
                    "playerId", order.playerId,
                    "itemId", order.gameItemId,
                    "quantity", 1);
            try {
                GameClient.Response response = client.post(adapter.baseUrl() + "/game/v1/grants", body);
                outcome = adapter.parseGrant(response.status(), response.body(), grantId);
                break;
            } catch (Exception failure) {
                outcome = GrantOutcome.failed(0, "delivery_transport_error");
            }
        }

        order.grantId = outcome.grantId();
        if (outcome.delivered()) {
            order.status = OrderStatus.DELIVERED;
        } else if (outcome.pending()) {
            order.status = OrderStatus.PENDING;
        } else {
            order.status = OrderStatus.FAILED;
            order.failureReason = outcome.error();
        }
        order.updatedAt = Instant.now();
    }

    public Order refund(String orderId) {
        Order order = ordersById.get(orderId);
        if (order == null) {
            throw new OrderRejected(404, "order_not_found");
        }
        GameAdapter adapter = registry.get(order.gameId);

        try {
            client.post(adapter.baseUrl() + "/game/v1/grants/" + order.grantId + "/revoke", Http.map());
        } catch (Exception failure) {
            // Revocation is retried by the finance batch job.
        }

        order.status = OrderStatus.REFUNDED;
        order.updatedAt = Instant.now();
        return order;
    }

    public Order find(String orderId) {
        return ordersById.get(orderId);
    }

    public List<Order> ordersFor(String playerId) {
        List<Order> orders = new ArrayList<>();
        for (Order order : ordersById.values()) {
            if (order.playerId.equals(playerId)) {
                orders.add(order);
            }
        }
        orders.sort(Comparator.comparing((Order o) -> o.createdAt).reversed());
        return orders;
    }
}
