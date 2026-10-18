package platform;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import platform.Models.Offer;
import platform.Models.Order;
import platform.adapters.GameAdapter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The player platform service: one API in front of every game integration.
 *
 * <pre>
 *   ./gradlew :platform:run
 * </pre>
 */
public final class PlatformMain {

    public static final int PORT = 4000;

    private final OrderService orders;
    private final CatalogService catalog;
    private final GameRegistry registry;
    private final GameClient client;

    public PlatformMain() {
        this.registry = new GameRegistry();
        this.client = new GameClient();
        this.catalog = new CatalogService(registry, client);
        this.orders = new OrderService(registry, client, catalog);
    }

    public static void main(String[] args) throws Exception {
        new PlatformMain().start();
        Thread.currentThread().join();
    }

    public HttpServer start() throws IOException {
        HttpServer server = Http.server(PORT);
        server.createContext("/v1/health", ex -> Http.json(ex, 200, Http.map("status", "ok")));
        server.createContext("/v1/games", this::handleGames);
        server.createContext("/v1/orders", this::handleOrders);
        server.createContext("/v1/players", this::handlePlayers);
        server.start();
        System.out.println("PLATFORM    listening on http://localhost:" + PORT);
        return server;
    }

    private void handleGames(HttpExchange ex) throws IOException {
        if (cors(ex)) {
            return;
        }
        String gameId = Http.segmentAfter(ex, "/v1/games/");
        if (gameId == null) {
            List<Map<String, Object>> games = new ArrayList<>();
            for (GameAdapter adapter : registry.all()) {
                games.add(Http.map(
                        "gameId", adapter.gameId(),
                        "displayName", adapter.displayName(),
                        "live", adapter.live()));
            }
            Http.json(ex, 200, Http.map("games", games));
            return;
        }
        if (Http.pathEndsWith(ex, "/inventory")) {
            handleGameInventory(ex, gameId);
            return;
        }
        if (!Http.pathEndsWith(ex, "/offers")) {
            Http.json(ex, 404, Http.map("error", "not_found"));
            return;
        }
        String playerId = Http.query(ex).get("playerId");
        if (playerId == null) {
            Http.json(ex, 400, Http.map("error", "playerId_required"));
            return;
        }
        List<Map<String, Object>> offers = new ArrayList<>();
        for (Offer offer : catalog.offersFor(gameId, playerId)) {
            offers.add(offer.toJson());
        }
        Http.json(ex, 200, Http.map("gameId", gameId, "offers", offers));
    }

    /**
     * Passes a game's own inventory response straight through, untouched, so a
     * caller can see what the game says a player owns rather than what we think.
     * Path: /v1/games/{gameId}/players/{playerId}/inventory
     */
    private void handleGameInventory(HttpExchange ex, String gameId) throws IOException {
        GameAdapter adapter = registry.get(gameId);
        if (adapter == null) {
            Http.json(ex, 404, Http.map("error", "unknown_game"));
            return;
        }
        String path = ex.getRequestURI().getPath();
        String marker = "/players/";
        int at = path.indexOf(marker);
        if (at < 0) {
            Http.json(ex, 400, Http.map("error", "playerId_required"));
            return;
        }
        String playerId = path.substring(at + marker.length()).replace("/inventory", "");
        if (playerId.isBlank()) {
            Http.json(ex, 400, Http.map("error", "playerId_required"));
            return;
        }

        try {
            GameClient.Response response = client.get(
                    adapter.baseUrl() + "/game/v1/players/" + playerId + "/inventory");
            Http.json(ex, 200, Http.map(
                    "gameId", gameId,
                    "status", response.status(),
                    "body", response.body()));
        } catch (Exception failure) {
            Http.json(ex, 502, Http.map("error", "game_unreachable", "gameId", gameId));
        }
    }

    private void handleOrders(HttpExchange ex) throws IOException {
        if (cors(ex)) {
            return;
        }
        String orderId = Http.segmentAfter(ex, "/v1/orders/");

        if (orderId != null && Http.pathEndsWith(ex, "/refund")) {
            try {
                Http.json(ex, 200, orders.refund(orderId).toJson());
            } catch (OrderService.OrderRejected rejected) {
                Http.json(ex, rejected.status, Http.map("error", rejected.code));
            }
            return;
        }
        if (orderId != null) {
            Order order = orders.find(orderId);
            if (order == null) {
                Http.json(ex, 404, Http.map("error", "order_not_found"));
                return;
            }
            Http.json(ex, 200, order.toJson());
            return;
        }
        if (!"POST".equals(ex.getRequestMethod())) {
            Http.json(ex, 405, Http.map("error", "method_not_allowed"));
            return;
        }

        Map<String, Object> body = Http.readJson(ex);
        String gameId = str(body.get("gameId"));
        String playerId = str(body.get("playerId"));
        String offerId = str(body.get("offerId"));
        String idempotencyKey = str(body.get("idempotencyKey"));
        if (gameId == null || playerId == null || offerId == null || idempotencyKey == null) {
            Http.json(ex, 400, Http.map("error", "missing_field"));
            return;
        }
        boolean preview = "true".equalsIgnoreCase(
                ex.getRequestHeaders().getFirst("X-Platform-Preview"));

        try {
            Order order = orders.createOrder(gameId, playerId, offerId, idempotencyKey, preview);
            Http.json(ex, 201, order.toJson());
        } catch (OrderService.OrderRejected rejected) {
            Http.json(ex, rejected.status, Http.map("error", rejected.code));
        }
    }

    private void handlePlayers(HttpExchange ex) throws IOException {
        if (cors(ex)) {
            return;
        }
        String playerId = Http.segmentAfter(ex, "/v1/players/");
        if (playerId == null || !Http.pathEndsWith(ex, "/orders")) {
            Http.json(ex, 404, Http.map("error", "not_found"));
            return;
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Order order : orders.ordersFor(playerId)) {
            result.add(order.toJson());
        }
        Http.json(ex, 200, Http.map("playerId", playerId, "orders", result));
    }

    private static boolean cors(HttpExchange ex) throws IOException {
        if ("OPTIONS".equals(ex.getRequestMethod())) {
            ex.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            ex.getResponseHeaders().add("Access-Control-Allow-Headers", "*");
            ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
            ex.sendResponseHeaders(204, -1);
            ex.close();
            return true;
        }
        return false;
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
