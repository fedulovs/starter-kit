package platform;

import platform.adapters.DriftClubAdapter;
import platform.adapters.GameAdapter;
import platform.adapters.IronSiegeAdapter;
import platform.adapters.NovaArenaAdapter;
import platform.adapters.TideFarmAdapter;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The games the platform knows how to talk to. */
public final class GameRegistry {

    private final Map<String, GameAdapter> adapters = new LinkedHashMap<>();

    public GameRegistry() {
        register(new NovaArenaAdapter());
        register(new TideFarmAdapter());
        register(new IronSiegeAdapter());
        register(new DriftClubAdapter());
    }

    public GameRegistry(List<GameAdapter> adapters) {
        adapters.forEach(this::register);
    }

    private void register(GameAdapter adapter) {
        this.adapters.put(adapter.gameId(), adapter);
    }

    public GameAdapter get(String gameId) {
        return adapters.get(gameId);
    }

    public List<GameAdapter> all() {
        return List.copyOf(adapters.values());
    }
}
