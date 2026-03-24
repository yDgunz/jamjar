import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Tracks", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Navigate to first session detail to see tracks
    const sessionLinks = page.locator('a[href^="/sessions/"]');
    await expect(sessionLinks.first()).toBeVisible({ timeout: 10_000 });
    await sessionLinks.first().click();
    await expect(page).toHaveURL(/\/sessions\/\d+/);
    // Wait for tracks to load
    await expect(page.getByText("#1")).toBeVisible({ timeout: 10_000 });
  });

  test("displays audio player for tracks", async ({ page }) => {
    const audioElements = page.locator("audio");
    await expect(audioElements.first()).toBeAttached({ timeout: 10_000 });
  });

  test("audio player has play button", async ({ page }) => {
    const playButtons = page.locator("button").filter({ has: page.locator("svg") });
    await expect(playButtons.first()).toBeVisible({ timeout: 10_000 });
  });

  test("track shows duration information", async ({ page }) => {
    // Tracks display duration in M:SS format
    const durationPattern = page.getByText(/^\d+:\d{2}$/);
    await expect(durationPattern.first()).toBeVisible({ timeout: 10_000 });
  });

  test("tagged tracks show song name as link to song history", async ({ page }) => {
    const songLinks = page.locator('a[href^="/songs/"]');
    const hasSongLink = await songLinks.first().isVisible().catch(() => false);

    if (!hasSongLink) {
      test.skip();
      return;
    }

    await songLinks.first().click();
    await expect(page).toHaveURL(/\/songs\/\d+/);
  });

  test("can tag a track with a song name", async ({ page }) => {
    // Find an untagged track's "Tag" button or a tagged track's "edit" button
    const tagButtons = page.getByText("Tag", { exact: true });
    const editButtons = page.getByText("edit", { exact: true });

    const hasTagButton = await tagButtons.first().isVisible().catch(() => false);
    const hasEditButton = await editButtons.first().isVisible().catch(() => false);

    if (hasTagButton) {
      await tagButtons.first().click();
    } else if (hasEditButton) {
      await editButtons.first().click();
    } else {
      test.skip();
      return;
    }

    const tagInput = page.getByPlaceholder("Search or type new song...");
    await expect(tagInput).toBeVisible({ timeout: 5_000 });

    await tagInput.fill("Fat Cat");

    const suggestion = page.getByText("Fat Cat").first();
    await expect(suggestion).toBeVisible({ timeout: 5_000 });
    await suggestion.click();

    // After tagging, the track should show the song name as a link
    await expect(page.getByRole("link", { name: "Fat Cat" }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("can untag a track", async ({ page }) => {
    // Find a tagged track (one with an "edit" button next to song name)
    const editButtons = page.getByText("edit", { exact: true });
    const hasEdit = await editButtons.first().isVisible().catch(() => false);
    if (!hasEdit) {
      test.skip();
      return;
    }

    await editButtons.first().click();

    const removeButton = page.getByText("Remove", { exact: true });
    await expect(removeButton).toBeVisible({ timeout: 5_000 });

    await removeButton.click();

    // The "Tag" button should reappear now that the track is untagged
    await expect(page.getByText("Tag", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });
});
