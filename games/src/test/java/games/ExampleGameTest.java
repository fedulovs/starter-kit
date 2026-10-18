package games;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * A starting point, not a suggestion about where your tests belong.
 * Delete it if it is in the way.
 */
class ExampleGameTest {

    @Test
    void mapHelperBuildsJsonShapedMaps() {
        Map<String, Object> value = Http.map("status", "ok", "count", 2);

        assertEquals("ok", value.get("status"));
        assertEquals(2, value.get("count"));
    }
}
