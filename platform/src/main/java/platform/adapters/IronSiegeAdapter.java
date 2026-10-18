package platform.adapters;

import com.fasterxml.jackson.databind.JsonNode;
import platform.Models.GrantOutcome;
import platform.Models.Offer;

import java.util.ArrayList;
import java.util.List;

/**
 * IRON SIEGE exposes prices as decimal numbers and runs on shared infrastructure,
 * so transient 5xx responses are expected.
 */
public final class IronSiegeAdapter implements GameAdapter {

    @Override
    public String gameId() {
        return "iron-siege";
    }

    @Override
    public String displayName() {
        return "Iron Siege";
    }

    @Override
    public String baseUrl() {
        return "http://localhost:4103";
    }

    @Override
    public boolean live() {
        return true;
    }

    @Override
    public List<Offer> parseCatalog(int httpStatus, JsonNode body) {
        List<Offer> offers = new ArrayList<>();
        if (httpStatus != 200) {
            return offers;
        }
        for (JsonNode item : body.path("items")) {
            String gameItemId = item.path("itemId").asText();
            long priceMinor = (long) (item.path("price").asDouble() * 100);
            offers.add(new Offer(
                    gameId(),
                    toOfferId(gameItemId),
                    gameItemId,
                    item.path("name").asText(),
                    priceMinor,
                    item.path("currency").asText()));
        }
        return offers;
    }

    @Override
    public GrantOutcome parseGrant(int httpStatus, JsonNode body, String grantId) {
        if (httpStatus == 200 || httpStatus == 201) {
            return GrantOutcome.granted(body.path("grantId").asText(grantId), httpStatus);
        }
        return GrantOutcome.failed(httpStatus, body.path("error").asText("unknown_error"));
    }

    @Override
    public GrantOutcome parseRevoke(int httpStatus, JsonNode body, String grantId) {
        if (httpStatus == 200) {
            return new GrantOutcome(grantId, body.path("status").asText("revoked"), httpStatus, null);
        }
        return GrantOutcome.failed(httpStatus, body.path("error").asText("unknown_error"));
    }
}
