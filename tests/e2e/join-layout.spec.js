import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 568 }, isMobile: true });

test("the phone join form fits a narrow screen and keeps the scanned code editable", async ({
  page,
}) => {
  const response = await page.request.get("/api/config");
  const { code } = await response.json();
  await page.goto(`/join?code=${code}`);

  await expect(page.getByRole("heading", { name: "Join table" })).toBeVisible();
  const name = page.getByLabel("Your name");
  const roomCode = page.getByLabel("Room code");
  const join = page.getByRole("button", { name: "Join", exact: true });
  await expect(name).toBeEditable();
  await expect(roomCode).toHaveValue(code);
  await expect(roomCode).toHaveAccessibleDescription(
    "Shown on the main screen.",
  );
  await roomCode.fill("abc234");
  await expect(roomCode).toHaveValue("ABC234");
  await expect(join).toBeEnabled();

  const button = await join.boundingBox();
  expect(button.height).toBeGreaterThanOrEqual(44);
  expect(button.y + button.height).toBeLessThanOrEqual(568);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  const display = page.getByRole("link", { name: "Show main screen" });
  await expect(display).toBeVisible();
  await expect(display).toHaveAttribute("href", new URL("/", page.url()).href);
});
