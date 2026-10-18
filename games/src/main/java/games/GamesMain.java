package games;

import java.util.List;
import java.util.Set;

/**
 * Boots the game backends.
 *
 * <pre>
 *   ./gradlew :games:run                       # all four
 *   ./gradlew :games:run --args="nova tide"    # a subset
 * </pre>
 */
public final class GamesMain {

    public static void main(String[] args) throws Exception {
        Set<String> wanted = args.length == 0
                ? Set.of("nova", "tide", "iron", "drift")
                : Set.of(args);

        if (wanted.contains("nova")) {
            new NovaArena().start();
        }
        if (wanted.contains("tide")) {
            new TideFarm().start();
        }
        if (wanted.contains("iron")) {
            new IronSiege().start();
        }
        if (wanted.contains("drift")) {
            new DriftClub().start();
        }

        List<String> unknown = List.of(args).stream()
                .filter(a -> !Set.of("nova", "tide", "iron", "drift").contains(a))
                .toList();
        if (!unknown.isEmpty()) {
            System.err.println("Unknown game(s): " + unknown);
        }

        Thread.currentThread().join();
    }
}
