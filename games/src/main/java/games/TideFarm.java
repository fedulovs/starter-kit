package games;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * TIDE FARM game backend.
 *
 * Built by the Tide Farm live-ops team on top of their own economy service. Their
 * economy layer predates the integration API, so some shapes are inherited from it.
 */
public final class TideFarm {

    public static final int PORT = 4102;

    private final Map<String, Map<String, Object>> players = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> grants = new ConcurrentHashMap<>();
    private final List<Map<String, Object>> catalog = new ArrayList<>();
    /** Limited-run items are stock-controlled by the economy service. */
    private final Map<String, java.util.concurrent.atomic.AtomicInteger> stock = new ConcurrentHashMap<>();

    public TideFarm() {
        players.put("p-1001", Http.map("playerId", "p-1001", "displayName", "Aino", "level", 12));
        players.put("p-1002", Http.map("playerId", "p-1002", "displayName", "Bo", "level", 3));
        players.put("p-1003", Http.map("playerId", "p-1003", "displayName", "Cleo", "level", 40));

        // Prices come straight out of the economy service, which stores them as decimal strings.
        catalog.add(catalogItem("GEMS_SMALL", "Handful of Seeds", "4.99", 1));
        catalog.add(catalogItem("GEMS_LARGE", "Sack of Seeds", "19.99", 1));
        catalog.add(catalogItem("HARVEST_PASS", "Harvest Pass", "9.99", 10));
        catalog.add(catalogItem("GOLDEN_TRACTOR", "Golden Tractor", "49.99", 25));

        // A limited run of two for the current season.
        stock.put("GOLDEN_TRACTOR", new java.util.concurrent.atomic.AtomicInteger(2));
    }

    private static Map<String, Object> catalogItem(String id, String name, String price, int minLevel) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("itemId", id);
        item.put("name", name);
        item.put("price", price);
        item.put("currency", "EUR");
        item.put("minLevel", minLevel);
        return item;
    }

    public HttpServer start() throws IOException {
        HttpServer server = Http.server(PORT);
        server.createContext("/game/v1/health", ex -> Http.json(ex, 200, Http.map("status", "ok")));
        server.createContext("/game/v1/players", this::handlePlayer);
        server.createContext("/game/v1/catalog", this::handleCatalog);
        server.createContext("/game/v1/grants", this::handleGrants);
        server.start();
        System.out.println("TIDE FARM   listening on http://localhost:" + PORT);
        return server;
    }

    private void handlePlayer(HttpExchange ex) throws IOException {
        if (Http.pathEndsWith(ex, "/inventory")) {
            handleInventory(ex);
            return;
        }
        String playerId = Http.segmentAfter(ex, "/game/v1/players/");
        Map<String, Object> player = playerId == null ? null : players.get(playerId);
        if (player == null) {
            // The economy service never 404s; callers are expected to check the error field.
            Http.json(ex, 200, Http.map("error", "player_not_found"));
            return;
        }
        Http.json(ex, 200, player);
    }

    private void handleCatalog(HttpExchange ex) throws IOException {
        String playerId = Http.query(ex).get("playerId");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 200, Http.map("error", "player_not_found"));
            return;
        }
        // The full storefront is returned; level gating is enforced at grant time.
        Http.json(ex, 200, Http.map("items", catalog));
    }

    private void handleGrants(HttpExchange ex) throws IOException {
        if (Http.pathEndsWith(ex, "/revoke")) {
            handleRevoke(ex);
            return;
        }
        if ("GET".equals(ex.getRequestMethod())) {
            String grantId = Http.segmentAfter(ex, "/game/v1/grants/");
            Map<String, Object> grant = grantId == null ? null : grants.get(grantId);
            if (grant == null) {
                Http.json(ex, 200, Http.map("error", "grant_not_found"));
                return;
            }
            Http.json(ex, 200, grant);
            return;
        }

        Map<String, Object> body = Http.readJson(ex);
        String grantId = String.valueOf(body.get("grantId"));
        String playerId = String.valueOf(body.get("playerId"));
        String itemId = String.valueOf(body.get("itemId"));

        Map<String, Object> existing = grants.get(grantId);
        if (existing != null) {
            // Replays are safe, but the economy service always reports a create.
            Http.json(ex, 201, existing);
            return;
        }

        Map<String, Object> player = players.get(playerId);
        if (player == null) {
            Http.json(ex, 200, Http.map("error", "player_not_found"));
            return;
        }
        Map<String, Object> item = catalog.stream()
                .filter(candidate -> candidate.get("itemId").equals(itemId))
                .findFirst()
                .orElse(null);
        if (item == null) {
            Http.json(ex, 422, Http.map("error", "unknown_item"));
            return;
        }

        int level = ((Number) player.get("level")).intValue();
        int minLevel = ((Number) item.get("minLevel")).intValue();
        if (level < minLevel) {
            Http.json(ex, 422, Http.map("error", "level_too_low",
                    "minLevel", minLevel, "playerLevel", level));
            return;
        }

        java.util.concurrent.atomic.AtomicInteger remaining = stock.get(itemId);
        if (remaining != null && remaining.getAndDecrement() <= 0) {
            remaining.set(0);
            Http.json(ex, 200, Http.map("error", "out_of_stock", "itemId", itemId));
            return;
        }

        Map<String, Object> grant = new LinkedHashMap<>();
        grant.put("grantId", grantId);
        grant.put("playerId", playerId);
        grant.put("itemId", itemId);
        grant.put("quantity", body.getOrDefault("quantity", 1));
        grant.put("status", "granted");
        grant.put("grantedAt", Instant.now().toString());
        grants.put(grantId, grant);
        Http.json(ex, 201, grant);
    }

    private void handleRevoke(HttpExchange ex) throws IOException {
        String grantId = Http.segmentAfter(ex, "/game/v1/grants/");
        Map<String, Object> grant = grantId == null ? null : grants.get(grantId);
        if (grant == null) {
            Http.json(ex, 200, Http.map("error", "grant_not_found"));
            return;
        }
        Instant grantedAt = Instant.parse(String.valueOf(grant.get("grantedAt")));
        if (Duration.between(grantedAt, Instant.now()).toHours() >= 24) {
            Http.json(ex, 422, Http.map("error", "revoke_window_expired"));
            return;
        }
        grant.put("status", "revoked");
        grant.put("revokedAt", Instant.now().toString());
        Http.json(ex, 200, grant);
    }

    private void handleInventory(HttpExchange ex) throws IOException {
        String playerId = Http.segmentAfter(ex, "/game/v1/players/");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 200, Http.map("error", "player_not_found"));
            return;
        }
        // Shape inherited from the economy service's own barn endpoint.
        List<Map<String, Object>> inventory = new ArrayList<>();
        for (Map<String, Object> grant : grantsFor(playerId)) {
            inventory.add(Http.map("itemId", grant.get("itemId"), "count", grant.get("quantity")));
        }
        Http.json(ex, 200, Http.map("playerId", playerId, "inventory", inventory));
    }

    public List<Map<String, Object>> grantsFor(String playerId) {
        return grants.values().stream()
                .filter(g -> playerId.equals(g.get("playerId")))
                .filter(g -> "granted".equals(g.get("status")))
                .toList();
    }
}
