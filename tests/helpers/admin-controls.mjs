/** Open the shared host panel in either the lobby or the phone settings sheet. */
export async function openAdminSection(
  page,
  name = "Table",
  { graphics = false } = {},
) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (!(await tab.isVisible())) {
    const settings = page.getByRole("button", {
      name: "Open settings",
      exact: true,
    });
    const drawer = page.getByRole("dialog", { name: "Settings", exact: true });
    if (!(await drawer.isVisible()) && (await settings.isVisible())) {
      await settings.click();
      await drawer.waitFor({ state: "visible" });
    }
    const host = page.locator("summary").filter({ hasText: /^Host controls$/ });
    if (await host.isVisible()) await host.click();
  }
  await tab.click();
  if (graphics) {
    const summary = page
      .locator(".ha-disclosure > summary")
      .filter({ hasText: "Graphics & effects" });
    const open = await summary.locator("..").evaluate((node) => node.open);
    if (!open) await summary.click();
  }
}
