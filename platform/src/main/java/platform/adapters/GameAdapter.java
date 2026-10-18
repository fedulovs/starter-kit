package platform.adapters;

import com.fasterxml.jackson.databind.JsonNode;
import platform.Models.GrantOutcome;
import platform.Models.Offer;

import java.util.List;

/**
 * Translates one game's integration API into platform terms.
 *
 * Every game is supposed to implement the same contract (see docs/game-integration-api.md).
 * In practice they do not, so each game gets its own adapter.
 */
public interface GameAdapter {

    String gameId();

    String displayName();

    String baseUrl();

    /** Whether the game is enabled for players. */
    boolean live();

    /** Parse the game's catalogue response into platform offers. */
    List<Offer> parseCatalog(int httpStatus, JsonNode body);

    /** Parse the game's response to a delivery request. */
    GrantOutcome parseGrant(int httpStatus, JsonNode body, String grantId);

    /** Parse the game's response to a revoke request. */
    GrantOutcome parseRevoke(int httpStatus, JsonNode body, String grantId);

    /** Platform-side offer id for a game item id. */
    default String toOfferId(String gameItemId) {
        return gameItemId.toLowerCase();
    }
}
