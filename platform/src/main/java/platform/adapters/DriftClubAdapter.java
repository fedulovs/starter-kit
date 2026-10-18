package platform.adapters;

import com.fasterxml.jackson.databind.JsonNode;
import platform.Models.GrantOutcome;
import platform.Models.Offer;

import java.util.ArrayList;
import java.util.List;

/**
 * DRIFT CLUB is integrated but not yet enabled for players.
 *
 * Its inventory service is queue-backed and it reports errors in its own envelope
 * shape, so this adapter is newer and less exercised than the others.
 */
public final class DriftClubAdapter implements GameAdapter {

    /** Prices are returned without a currency field. */
    private static final String DEFAULT_CURRENCY = "EUR";

    @Override
    public String gameId() {
        return "drift-club";
    }

    @Override
    public String displayName() {
        return "Drift Club";
    }

    @Override
    public String baseUrl() {
        return "http://localhost:4104";
    }

    @Override
    public boolean live() {
        return false;
    }

    @Override
    public List<Offer> parseCatalog(int httpStatus, JsonNode body) {
        List<Offer> offers = new ArrayList<>();
        if (httpStatus != 200) {
            return offers;
        }
        for (JsonNode item : body.path("items")) {
            String gameItemId = item.path("itemId").asText();
            offers.add(new Offer(
                    gameId(),
                    toOfferId(gameItemId),
                    gameItemId,
                    item.path("name").asText(),
                    item.path("priceMinor").asLong(),
                    item.path("currency").asText(DEFAULT_CURRENCY)));
        }
        return offers;
    }

    @Override
    public GrantOutcome parseGrant(int httpStatus, JsonNode body, String grantId) {
        if (httpStatus == 202) {
            return GrantOutcome.pending(grantId, httpStatus);
        }
        if (httpStatus == 200 || httpStatus == 201) {
            return GrantOutcome.granted(body.path("grantId").asText(grantId), httpStatus);
        }
        return GrantOutcome.failed(httpStatus, firstErrorCode(body));
    }

    @Override
    public GrantOutcome parseRevoke(int httpStatus, JsonNode body, String grantId) {
        if (httpStatus == 200) {
            return new GrantOutcome(grantId, body.path("status").asText("revoked"), httpStatus, null);
        }
        return GrantOutcome.failed(httpStatus, firstErrorCode(body));
    }

    private static String firstErrorCode(JsonNode body) {
        JsonNode errors = body.path("errors");
        if (errors.isArray() && !errors.isEmpty()) {
            return errors.get(0).path("code").asText("unknown_error");
        }
        return "unknown_error";
    }
}
