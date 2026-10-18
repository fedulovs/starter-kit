package platform;

import java.time.Instant;
import java.util.Map;

/** Platform-facing domain types. */
public final class Models {

    private Models() {
    }

    /**
     * A purchasable offer, normalised across games.
     *
     * @param offerId    platform-side identifier, stable across games
     * @param gameItemId the identifier the game itself uses, sent back on delivery
     */
    public record Offer(String gameId, String offerId, String gameItemId, String name,
                        long priceMinor, String currency) {
        public Map<String, Object> toJson() {
            return Http.map(
                    "gameId", gameId,
                    "offerId", offerId,
                    "gameItemId", gameItemId,
                    "name", name,
                    "priceMinor", priceMinor,
                    "currency", currency);
        }
    }

    public enum OrderStatus {
        PENDING, DELIVERED, FAILED, REFUNDED
    }

    public static final class Order {
        public final String orderId;
        public final String gameId;
        public final String playerId;
        public final String offerId;
        public final String gameItemId;
        public final long priceMinor;
        public final String currency;
        public final String idempotencyKey;
        public final Instant createdAt;

        public volatile OrderStatus status = OrderStatus.PENDING;
        public volatile String grantId;
        public volatile String failureReason;
        public volatile Instant updatedAt;

        public Order(String orderId, String gameId, String playerId, String offerId, String gameItemId,
                     long priceMinor, String currency, String idempotencyKey) {
            this.orderId = orderId;
            this.gameId = gameId;
            this.playerId = playerId;
            this.offerId = offerId;
            this.gameItemId = gameItemId;
            this.priceMinor = priceMinor;
            this.currency = currency;
            this.idempotencyKey = idempotencyKey;
            this.createdAt = Instant.now();
            this.updatedAt = this.createdAt;
        }

        public Map<String, Object> toJson() {
            Map<String, Object> json = Http.map(
                    "orderId", orderId,
                    "gameId", gameId,
                    "playerId", playerId,
                    "offerId", offerId,
                    "priceMinor", priceMinor,
                    "currency", currency,
                    "status", status.name().toLowerCase(),
                    "createdAt", createdAt.toString(),
                    "updatedAt", updatedAt.toString());
            json.put("grantId", grantId);
            json.put("failureReason", failureReason);
            return json;
        }
    }

    /** Outcome of asking a game to deliver an offer. */
    public record GrantOutcome(String grantId, String status, int httpStatus, String error) {

        public static GrantOutcome granted(String grantId, int httpStatus) {
            return new GrantOutcome(grantId, "granted", httpStatus, null);
        }

        public static GrantOutcome pending(String grantId, int httpStatus) {
            return new GrantOutcome(grantId, "pending", httpStatus, null);
        }

        public static GrantOutcome failed(int httpStatus, String error) {
            return new GrantOutcome(null, "failed", httpStatus, error);
        }

        public boolean delivered() {
            return "granted".equals(status);
        }

        public boolean pending() {
            return "pending".equals(status);
        }
    }
}
