/**
 * Test naming and tags.
 *
 * Titles start with `[gameId][RULE]` so the results table can be built from
 * the report, e.g. "[tide-farm][C3] unknown player returns 404".
 * Run a slice with `npx playwright test --grep @contract`.
 */

export const TAG = {
  /** A rule stated in docs/game-integration-api.md, checked against a game directly. */
  contract: "@contract",
  /** Needs the storefront started with PREVIEW_GAMES=true. */
  preview: "@preview",
} as const;

export function title(gameId: string, rule: string, description: string): string {
  return `[${gameId}][${rule}] ${description}`;
}
