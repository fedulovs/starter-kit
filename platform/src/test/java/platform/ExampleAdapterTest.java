package platform;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import platform.Models.Offer;
import platform.adapters.NovaArenaAdapter;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * A starting point, not a suggestion about where your tests belong.
 * Delete it if it is in the way.
 */
class ExampleAdapterTest {

    @Test
    void parsesNovaArenaCatalogue() throws Exception {
        JsonNode body = Http.MAPPER.readTree("""
                {"items":[{"itemId":"gems_small","name":"Small Gem Pack",
                           "priceMinor":499,"currency":"EUR"}]}
                """);

        List<Offer> offers = new NovaArenaAdapter().parseCatalog(200, body);

        assertEquals(1, offers.size());
        assertEquals(499, offers.get(0).priceMinor());
        assertEquals("EUR", offers.get(0).currency());
    }
}
