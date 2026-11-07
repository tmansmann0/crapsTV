import { expect } from "@playwright/test";

// Read the actual visible mesh hit regions, then exercise the real canvas raycast.
export async function clickTV(page, action) {
  const host = page.locator(".table-canvas");
  await expect
    .poll(
      async () => {
        const actions = JSON.parse(
          (await host.getAttribute("data-ui-actions")) || "{}",
        );
        return !!actions[action];
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const actions = JSON.parse(await host.getAttribute("data-ui-actions"));
  await host
    .locator("canvas")
    .click({ position: { x: actions[action].x, y: actions[action].y } });
}
