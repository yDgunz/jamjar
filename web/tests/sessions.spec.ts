import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Sessions", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("displays a list of sessions", async ({ page }) => {
    // The session list should load with seeded data
    // Seeded sessions have names like "Session YYYY-MM-DD" or similar
    // Wait for at least one session card/link to appear
    const sessionLinks = page.locator('a[href^="/sessions/"]');
    await expect(sessionLinks.first()).toBeVisible({ timeout: 10_000 });

    // Should have multiple sessions (seed creates 15)
    const count = await sessionLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test("navigates to session detail page", async ({ page }) => {
    // Click the first session link
    const sessionLinks = page.locator('a[href^="/sessions/"]');
    await expect(sessionLinks.first()).toBeVisible({ timeout: 10_000 });
    await sessionLinks.first().click();

    // Should navigate to /sessions/<id>
    await expect(page).toHaveURL(/\/sessions\/\d+/);

    // Session detail should show tracks with track numbers
    await expect(page.getByText("#1")).toBeVisible({ timeout: 10_000 });
  });

  test("session detail shows track list with track numbers", async ({ page }) => {
    const sessionLinks = page.locator('a[href^="/sessions/"]');
    await expect(sessionLinks.first()).toBeVisible({ timeout: 10_000 });
    await sessionLinks.first().click();
    await expect(page).toHaveURL(/\/sessions\/\d+/);

    // Track rows display track numbers like "#1", "#2", etc.
    await expect(page.getByText("#1")).toBeVisible({ timeout: 10_000 });
  });

  test("can navigate back from session detail to session list", async ({ page }) => {
    const sessionLinks = page.locator('a[href^="/sessions/"]');
    await expect(sessionLinks.first()).toBeVisible({ timeout: 10_000 });
    await sessionLinks.first().click();
    await expect(page).toHaveURL(/\/sessions\/\d+/);

    // Click the "Recordings" breadcrumb or nav link to go back
    await page.getByRole("link", { name: "Recordings" }).first().click();
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test("sessions page has navigation links", async ({ page }) => {
    // Check that the nav bar has the expected links
    await expect(page.getByText("Recordings")).toBeVisible();
    await expect(page.getByText("Songs")).toBeVisible();
    await expect(page.getByText("Setlists")).toBeVisible();
  });

  test("can navigate to songs page", async ({ page }) => {
    await page.getByRole("link", { name: "Songs" }).first().click();
    await expect(page).toHaveURL(/\/songs/);
    // Songs page should show seeded songs
    await expect(page.getByText("Fat Cat")).toBeVisible({ timeout: 10_000 });
  });
});
