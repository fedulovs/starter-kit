package platform.adapters;

import com.fasterxml.jackson.databind.JsonNode;
import platform.Models.GrantOutcome;
import platform.Models.Offer;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * TIDE FARM returns prices as decimal strings and reports some failures with HTTP 200.
 */
public final class TideFarmAdapter implements GameAdapter {

    @Override
    public String gameId() {
        return "tide-farm";
    }

    @Override
    public String displayName() {
        return "Tide Farm";
    }

    @Override
    public String baseUrl() {
        return "http://localhost:4102";
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
            long priceMinor = new BigDecimal(item.path("price").asText("0"))
                    .movePointRight(2)
                    .longValueExact();
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
