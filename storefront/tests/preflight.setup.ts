import { expect, test as setup } from "@playwright/test";
import { GAMES, PLATFORM_URL, STOREFRONT_URL } from "./support/games.js";

/**
 * Runs before both suites. When a service is down, this is the one failure to
 * read; without it every test fails with a connection error.
 */
setup("the stack is running", async ({ request }) => {
  const targets = [
    { name: "storefront", url: `${STOREFRONT_URL}/api/games` },
    { name: "platform", url: `${PLATFORM_URL}/v1/health` },
    ...GAMES.map((game) => ({ name: game.gameId, url: `${game.baseUrl}/game/v1/health` })),
  ];

  const down: string[] = [];
  for (const target of targets) {
    try {
      const response = await request.get(target.url, { timeout: 5_000 });
      if (!response.ok()) {
        down.push(`${target.name} (${target.url}) answered ${response.status()}`);
      }
    } catch (error) {
      down.push(`${target.name} (${target.url}) unreachable`);
    }
  }

  expect(down, "Start the stack with ./start.sh from the repo root first").toEqual([]);
});
