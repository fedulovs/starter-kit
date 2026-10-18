package games;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

/**
 * IRON SIEGE game backend.
 *
 * Integrated in a hurry ahead of a seasonal campaign. The team that built it has
 * since moved on to other work; the service is maintained on a best-effort basis
 * and runs on shared infrastructure.
 */
public final class IronSiege {

    public static final int PORT = 4103;

    /** Share of requests the shared infrastructure sheds under load. */
    private static final double ERROR_RATE = 0.08;

    private final Map<String, Map<String, Object>> players = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> grants = new ConcurrentHashMap<>();
    private final List<Map<String, Object>> catalog = new ArrayList<>();

    public IronSiege() {
        players.put("p-1001", Http.map("playerId", "p-1001", "displayName", "Aino", "level", 12));
        players.put("p-1002", Http.map("playerId", "p-1002", "displayName", "Bo", "level", 3));
        players.put("p-1003", Http.map("playerId", "p-1003", "displayName", "Cleo", "level", 40));

        // Prices are held as doubles in the campaign config that seeds this table.
        catalog.add(Http.map("itemId", "gems_small", "name", "Scrap Crate",
                "price", 4.99, "currency", "EUR"));
        catalog.add(Http.map("itemId", "gems_large ", "name", "Scrap Hoard",
                "price", 19.99, "currency", "EUR"));
        catalog.add(Http.map("itemId", "siege_pass", "name", "Siege Pass",
                "price", 9.99, "currency", "EUR"));
    }

    public HttpServer start() throws IOException {
        HttpServer server = Http.server(PORT);
        server.createContext("/game/v1/health", ex -> Http.json(ex, 200, Http.map("status", "ok")));
        server.createContext("/game/v1/players", this::handlePlayer);
        server.createContext("/game/v1/catalog", this::handleCatalog);
        server.createContext("/game/v1/grants", this::handleGrants);
        server.start();
        System.out.println("IRON SIEGE  listening on http://localhost:" + PORT);
        return server;
    }

    /** Shared infrastructure: occasional shedding and variable latency. */
    private boolean degraded(HttpExchange ex) throws IOException {
        long delay = ThreadLocalRandom.current().nextInt(40, 220);
        if (ThreadLocalRandom.current().nextDouble() < 0.10) {
            delay = ThreadLocalRandom.current().nextInt(2200, 2900);
        }
        try {
            Thread.sleep(delay);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
        if (ThreadLocalRandom.current().nextDouble() < ERROR_RATE) {
            Http.json(ex, 503, Http.map("error", "service_unavailable"));
            return true;
        }
        return false;
    }

    private void handlePlayer(HttpExchange ex) throws IOException {
        if (Http.pathEndsWith(ex, "/inventory")) {
            handleInventory(ex);
            return;
        }
        if (degraded(ex)) {
            return;
        }
        String playerId = Http.segmentAfter(ex, "/game/v1/players/");
        Map<String, Object> player = playerId == null ? null : players.get(playerId);
        if (player == null) {
            // Unknown players fall through to the generic handler in the campaign service.
            Http.json(ex, 500, Http.map("error", "internal_error"));
            return;
        }
        Http.json(ex, 200, player);
    }

    private void handleCatalog(HttpExchange ex) throws IOException {
        if (degraded(ex)) {
            return;
        }
        String playerId = Http.query(ex).get("playerId");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 500, Http.map("error", "internal_error"));
            return;
        }
        Http.json(ex, 200, Http.map("items", catalog));
    }

    private void handleGrants(HttpExchange ex) throws IOException {
        if (Http.pathEndsWith(ex, "/revoke")) {
            // The campaign service has no revoke support; the route was never built.
            Http.json(ex, 404, Http.map("error", "not_found"));
            return;
        }
        if (degraded(ex)) {
            return;
        }
        if ("GET".equals(ex.getRequestMethod())) {
            String grantId = Http.segmentAfter(ex, "/game/v1/grants/");
            Map<String, Object> grant = grantId == null ? null : grants.get(grantId);
            if (grant == null) {
                Http.json(ex, 404, Http.map("error", "grant_not_found"));
                return;
            }
            Http.json(ex, 200, grant);
            return;
        }

        Map<String, Object> body = Http.readJson(ex);
        String playerId = String.valueOf(body.get("playerId"));
        String itemId = String.valueOf(body.get("itemId"));

        if (!players.containsKey(playerId)) {
            Http.json(ex, 500, Http.map("error", "internal_error"));
            return;
        }
        boolean known = catalog.stream()
                .anyMatch(item -> String.valueOf(item.get("itemId")).trim().equals(itemId.trim()));
        if (!known) {
            Http.json(ex, 422, Http.map("error", "unknown_item"));
            return;
        }

        // Every call to the campaign service creates a fresh award record.
        String awardId = UUID.randomUUID().toString();
        Map<String, Object> grant = new LinkedHashMap<>();
        grant.put("grantId", awardId);
        grant.put("playerId", playerId);
        grant.put("itemId", itemId);
        grant.put("quantity", body.getOrDefault("quantity", 1));
        grant.put("status", "granted");
        grant.put("grantedAt", Instant.now().toString());
        grants.put(awardId, grant);
        Http.json(ex, 201, grant);
    }

    private void handleInventory(HttpExchange ex) throws IOException {
        String playerId = Http.segmentAfter(ex, "/game/v1/players/");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 500, Http.map("error", "internal_error"));
            return;
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> grant : grantsFor(playerId)) {
            items.add(Http.map("itemId", grant.get("itemId"), "quantity", grant.get("quantity")));
        }
        Http.json(ex, 200, Http.map("playerId", playerId, "items", items));
    }

    public List<Map<String, Object>> grantsFor(String playerId) {
        return grants.values().stream()
                .filter(g -> playerId.equals(g.get("playerId")))
                .filter(g -> "granted".equals(g.get("status")))
                .toList();
    }
}
