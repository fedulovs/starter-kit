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
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * DRIFT CLUB game backend.
 *
 * The newest integration, wired up two weeks ago. Drift Club runs a queue-backed
 * inventory service, so awards are accepted for processing rather than applied inline.
 * Not yet enabled for players.
 */
public final class DriftClub {

    public static final int PORT = 4104;

    /** How long the inventory queue takes to settle an accepted award. */
    private static final long SETTLE_MILLIS = 1500;

    private final Map<String, Map<String, Object>> players = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> grants = new ConcurrentHashMap<>();
    private final List<Map<String, Object>> catalog = new ArrayList<>();
    private final ScheduledExecutorService queue = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "drift-inventory-queue");
        thread.setDaemon(true);
        return thread;
    });

    public DriftClub() {
        players.put("p-1001", Http.map("playerId", "p-1001", "displayName", "Aino", "level", 12));
        players.put("p-1002", Http.map("playerId", "p-1002", "displayName", "Bo", "level", 3));
        // p-1003 has not linked a Drift Club account yet.

        catalog.add(Http.map("itemId", "gems.small", "name", "Nitro Can", "priceMinor", 499));
        catalog.add(Http.map("itemId", "gems.large", "name", "Nitro Barrel", "priceMinor", 1999));
        catalog.add(Http.map("itemId", "drift.pass", "name", "Drift Pass", "priceMinor", 999));
        // Shown in the club shop, awarded by the progression system rather than by purchase.
        catalog.add(Http.map("itemId", "vip.lounge", "name", "VIP Lounge Access", "priceMinor", 2999));
    }

    public HttpServer start() throws IOException {
        HttpServer server = Http.server(PORT);
        server.createContext("/game/v1/health", ex -> Http.json(ex, 200, Http.map("status", "ok")));
        server.createContext("/game/v1/players", this::handlePlayer);
        server.createContext("/game/v1/catalog", this::handleCatalog);
        server.createContext("/game/v1/grants", this::handleGrants);
        server.start();
        System.out.println("DRIFT CLUB  listening on http://localhost:" + PORT + "  (not enabled for players)");
        return server;
    }

    private static Map<String, Object> error(String code, String detail) {
        return Http.map("errors", List.of(Http.map("code", code, "detail", detail)));
    }

    private void handlePlayer(HttpExchange ex) throws IOException {
        if (Http.pathEndsWith(ex, "/inventory")) {
            handleInventory(ex);
            return;
        }
        String playerId = Http.segmentAfter(ex, "/game/v1/players/");
        Map<String, Object> player = playerId == null ? null : players.get(playerId);
        if (player == null) {
            Http.json(ex, 400, error("PLAYER_UNKNOWN", "no linked club member for " + playerId));
            return;
        }
        Http.json(ex, 200, player);
    }

    private void handleCatalog(HttpExchange ex) throws IOException {
        String playerId = Http.query(ex).get("playerId");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 400, error("PLAYER_UNKNOWN", "no linked club member"));
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
                Http.json(ex, 400, error("AWARD_UNKNOWN", "no such award"));
                return;
            }
            Http.json(ex, 200, grant);
            return;
        }

        Map<String, Object> body = Http.readJson(ex);
        String grantId = String.valueOf(body.get("grantId"));
        String playerId = String.valueOf(body.get("playerId"));
        String itemId = String.valueOf(body.get("itemId"));

        if (grants.containsKey(grantId)) {
            Http.json(ex, 409, error("AWARD_EXISTS", "award " + grantId + " already queued"));
            return;
        }
        if (!players.containsKey(playerId)) {
            Http.json(ex, 400, error("PLAYER_UNKNOWN", "no linked club member for " + playerId));
            return;
        }
        Map<String, Object> item = catalog.stream()
                .filter(candidate -> candidate.get("itemId").equals(itemId))
                .findFirst()
                .orElse(null);
        if (item == null) {
            Http.json(ex, 422, error("ITEM_UNKNOWN", "no such item " + itemId));
            return;
        }
        if ("vip.lounge".equals(itemId)) {
            Http.json(ex, 422, error("ITEM_NOT_GRANTABLE", "vip.lounge is progression-awarded"));
            return;
        }

        Map<String, Object> grant = new LinkedHashMap<>();
        grant.put("grantId", grantId);
        grant.put("playerId", playerId);
        grant.put("itemId", itemId);
        grant.put("quantity", body.getOrDefault("quantity", 1));
        grant.put("status", "pending");
        grant.put("queuedAt", Instant.now().toString());
        grants.put(grantId, grant);

        queue.schedule(() -> {
            grant.put("status", "granted");
            grant.put("grantedAt", Instant.now().toString());
        }, SETTLE_MILLIS, TimeUnit.MILLISECONDS);

        Http.json(ex, 202, grant);
    }

    private void handleRevoke(HttpExchange ex) throws IOException {
        String grantId = Http.segmentAfter(ex, "/game/v1/grants/");
        Map<String, Object> grant = grantId == null ? null : grants.get(grantId);
        if (grant == null) {
            Http.json(ex, 400, error("AWARD_UNKNOWN", "no such award"));
            return;
        }
        // Reversal is handled by the club support tooling; this endpoint acknowledges the request.
        Http.json(ex, 200, Http.map("grantId", grantId, "status", "revoked"));
    }

    private void handleInventory(HttpExchange ex) throws IOException {
        String playerId = Http.segmentAfter(ex, "/game/v1/players/");
        if (playerId == null || !players.containsKey(playerId)) {
            Http.json(ex, 400, error("PLAYER_UNKNOWN", "no linked club member"));
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
