import { type Page, expect } from "@playwright/test";

/**
 * Seeded test credentials from scripts/seed-db.py.
 * Password defaults to "test" (overridden by JAM_QA_PASSWORD in QA envs).
 */
export const TEST_USER = {
  email: "test",
  password: process.env.JAM_QA_PASSWORD ?? "test",
  name: "Eric",
  role: "superadmin",
};

export const SECONDARY_USER = {
  email: "dave@example.com",
  password: process.env.JAM_QA_PASSWORD ?? "test",
  name: "Dave",
};

/**
 * Log in via the login form and wait for redirect to /sessions.
 */
export async function login(
  page: Page,
  email = TEST_USER.email,
  password = TEST_USER.password,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // After successful login the app redirects to /sessions
  await page.waitForURL("**/sessions", { timeout: 10_000 });
}

/**
 * Log out via the account menu (desktop).
 */
export async function logout(page: Page): Promise<void> {
  // Open account menu — the avatar button
  await page.getByLabel("Account menu").click();
  await page.getByText("Sign out").click();
  // Should land on login page
  await expect(page).toHaveURL(/\/login/);
}
