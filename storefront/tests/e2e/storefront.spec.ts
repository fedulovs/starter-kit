import { expect, test } from "@playwright/test";

/**
 * A starting point, not a suggestion about where your tests belong.
 * Delete it if it is in the way.
 */
test("the store lists the games a player can buy from", async ({ page }) => {
  await page.goto("/");

  const tabs = page.getByTestId("game-tabs").getByRole("button");
  await expect(tabs.first()).toBeVisible();
  expect(await tabs.count()).toBeGreaterThan(0);
});
