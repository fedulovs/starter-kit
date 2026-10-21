/**
 * The games under test, as the tests need to address them.
 *
 * Drives every parametrised test: adding a game is adding a row. Only facts
 * needed to make calls live here (where it is, who exists, one item to buy).
 * What a game *should* do comes from docs/game-integration-api.md and belongs
 * in the tests, not in this table.
 */

export interface GameUnderTest {
  /** Platform identifier, e.g. "nova-arena". */
  gameId: string;
  displayName: string;
  /** Game backend, called directly by the contract tests. */
  baseUrl: string;
  /** Whether the platform reports the game as enabled for players. */
  live: boolean;
  /** Players this game knows about. */
  players: string[];
  /** A player id no game knows. */
  unknownPlayer: string;
  /**
   * One cheap item every known player of this game can buy, used wherever a
   * test just needs "a purchase". `itemId` is the game's own identifier,
   * `offerId` what the platform calls it.
   */
  sample: { itemId: string; offerId: string };
}

const env = (name: string, fallback: string) => process.env[name] ?? fallback;

export const GAMES: GameUnderTest[] = [
  {
    gameId: "nova-arena",
    displayName: "Nova Arena",
    baseUrl: env("NOVA_URL", "http://localhost:4101"),
    live: true,
    players: ["p-1001", "p-1002", "p-1003"],
    unknownPlayer: "p-9999",
    sample: { itemId: "gems_small", offerId: "gems_small" },
  },
  {
    gameId: "tide-farm",
    displayName: "Tide Farm",
    baseUrl: env("TIDE_URL", "http://localhost:4102"),
    live: true,
    players: ["p-1001", "p-1002", "p-1003"],
    unknownPlayer: "p-9999",
    sample: { itemId: "GEMS_SMALL", offerId: "gems_small" },
  },
  {
    gameId: "iron-siege",
    displayName: "Iron Siege",
    baseUrl: env("IRON_URL", "http://localhost:4103"),
    live: true,
    players: ["p-1001", "p-1002", "p-1003"],
    unknownPlayer: "p-9999",
    sample: { itemId: "gems_small", offerId: "gems_small" },
  },
  {
    gameId: "drift-club",
    displayName: "Drift Club",
    baseUrl: env("DRIFT_URL", "http://localhost:4104"),
    live: false,
    // p-1003 has not linked a Drift Club account.
    players: ["p-1001", "p-1002"],
    unknownPlayer: "p-9999",
    sample: { itemId: "gems.small", offerId: "gems.small" },
  },
];

export const PLATFORM_URL = env("PLATFORM_URL", "http://localhost:4000");
export const STOREFRONT_URL = env("STOREFRONT_URL", "http://localhost:3000");

export function game(gameId: string): GameUnderTest {
  const found = GAMES.find((candidate) => candidate.gameId === gameId);
  if (!found) {
    throw new Error(`unknown game in test setup: ${gameId}`);
  }
  return found;
}
