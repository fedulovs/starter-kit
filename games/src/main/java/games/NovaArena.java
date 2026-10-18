package games;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * NOVA ARENA game backend.
 *
 * The oldest of our integrations. Team is responsive and the implementation has been
 * stable in production for about two years.
 */
public final class NovaArena {

    public static final int PORT = 4101;

    private final Map<String, Map<String, Object>> players = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> grants = new ConcurrentHashMap<>();
    private final List<Map<String, Object>> catalog = new ArrayList<>();

    public NovaArena() {
        players.put("p-1001", Http.map("playerId", "p-1001", "displayName", "Aino", "level", 12));
        players.put("p-1002", Http.map("playerId", "p-1002", "displayName", "Bo", "level", 3));
        players.put("p-1003", Http.map("playerId", "p-1003", "displayName", "Cleo", "level", 40));

        catalog.add(Http.map("itemId", "gems_small", "name", "Small Gem Pack",
                "priceMinor", 499, "currency", "EUR"));
        catalog.add(Http.map("itemId", "gems_large", "name", "Large Gem Pack",
                "priceMinor", 1999, "currency", "EUR"));
        catalog.add(Http.map("itemId", "battle_pass", "name", "Season Battle Pass",
                "priceMinor", 999, "currency", "EUR"));
    }

    public HttpServer start() throws IOException {
        HttpServer server = Http.server(PORT);
        server.createContext("/game/v1/health", ex -> Http.json(ex, 200, Http.map("status", "ok")));
        server.createContext("/game/v1/players", this::handlePlayer);
        server.createContext("/game/v1/catalog", this::handleCatalog);
        server.createContext("/game/v1/grants", this::handleGrants);
        server.start();
        System.out.println("NOVA ARENA  listening on http://localhost:" + PORT);
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
            Http.json(ex, 404, Http.map("error", "player_not_found"));
            return;
        }
        Http.json(ex, 200, player);
    }

    private void handleCatalog(HttpExchange ex) throws IOException {
        String playerId = Http.query(ex).get("playerId");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 404, Http.map("error", "player_not_found"));
            return;
        }
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
                Http.json(ex, 404, Http.map("error", "grant_not_found"));
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
            // Idempotent replay: same grant, 200 instead of 201.
            Http.json(ex, 200, existing);
            return;
        }
        if (!players.containsKey(playerId)) {
            Http.json(ex, 404, Http.map("error", "player_not_found"));
            return;
        }
        boolean known = catalog.stream().anyMatch(item -> item.get("itemId").equals(itemId));
        if (!known) {
            Http.json(ex, 422, Http.map("error", "unknown_item"));
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
            Http.json(ex, 404, Http.map("error", "grant_not_found"));
            return;
        }
        grant.put("status", "revoked");
        grant.put("revokedAt", Instant.now().toString());
        Http.json(ex, 200, grant);
    }

    private void handleInventory(HttpExchange ex) throws IOException {
        String playerId = Http.segmentAfter(ex, "/game/v1/players/");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 404, Http.map("error", "player_not_found"));
            return;
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> grant : grantsFor(playerId)) {
            items.add(Http.map("itemId", grant.get("itemId"), "quantity", grant.get("quantity")));
        }
        Http.json(ex, 200, Http.map("playerId", playerId, "items", items));
    }

    /** What the player actually owns right now. */
    public List<Map<String, Object>> grantsFor(String playerId) {
        return grants.values().stream()
                .filter(g -> playerId.equals(g.get("playerId")))
                .filter(g -> "granted".equals(g.get("status")))
                .toList();
    }
}
