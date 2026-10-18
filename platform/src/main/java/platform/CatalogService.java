package platform;

import platform.Models.Offer;
import platform.adapters.GameAdapter;

import java.util.List;

/** Reads offers from a game and normalises them for the storefront. */
public final class CatalogService {

    private final GameRegistry registry;
    private final GameClient client;

    public CatalogService(GameRegistry registry, GameClient client) {
        this.registry = registry;
        this.client = client;
    }

    public List<Offer> offersFor(String gameId, String playerId) {
        GameAdapter adapter = registry.get(gameId);
        if (adapter == null) {
            return List.of();
        }
        try {
            GameClient.Response response = client.get(
                    adapter.baseUrl() + "/game/v1/catalog?playerId=" + playerId);
            return adapter.parseCatalog(response.status(), response.body());
        } catch (Exception failure) {
            return List.of();
        }
    }

    public Offer findOffer(String gameId, String playerId, String offerId) {
        return offersFor(gameId, playerId).stream()
                .filter(offer -> offer.offerId().equals(offerId))
                .findFirst()
                .orElse(null);
    }
}
