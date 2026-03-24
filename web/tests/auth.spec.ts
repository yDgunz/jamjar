import { test, expect } from "@playwright/test";
import { login, logout, TEST_USER } from "./helpers";

test.describe("Authentication", () => {
  test("shows the login page with branding", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "JamJar" })).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("wrong@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Error message should appear
    await expect(page.getByText(/invalid|failed/i)).toBeVisible({ timeout: 5_000 });
    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test("logs in with valid credentials and redirects to sessions", async ({ page }) => {
    await login(page);
    // Verify we're on the sessions page
    await expect(page).toHaveURL(/\/sessions/);
    // Should see the Recordings nav link as active or session list content
    await expect(page.getByText("Recordings")).toBeVisible();
  });

  test("shows user info in account menu after login", async ({ page }) => {
    await login(page);
    // Click the account avatar to open menu
    await page.getByLabel("Account menu").click();
    // Should see the user's name
    await expect(page.getByText(TEST_USER.name)).toBeVisible();
  });

  test("logs out and returns to login page", async ({ page }) => {
    await login(page);
    await logout(page);
    // Verify we're back on login
    await expect(page.getByLabel("Username")).toBeVisible();
  });

  test("redirects unauthenticated users away from protected pages", async ({ page }) => {
    // Try to access sessions without logging in — the app should redirect to login
    await page.goto("/sessions");
    // The AuthProvider redirects to /login after the API returns 401
    await expect(page.getByLabel("Username")).toBeVisible({ timeout: 10_000 });
  });

  test("forgot password link is accessible from login page", async ({ page }) => {
    await page.goto("/login");
    const forgotLink = page.getByText("Forgot password?");
    await expect(forgotLink).toBeVisible();
    await forgotLink.click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });
});
