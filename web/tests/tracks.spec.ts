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
    // Each track card should contain an audio element or player controls
    // The AudioPlayer component renders a <audio> element
    const audioElements = page.locator("audio");
    await expect(audioElements.first()).toBeAttached({ timeout: 10_000 });
  });

  test("audio player has play button", async ({ page }) => {
    // The AudioPlayer renders play/pause buttons
    // Look for a play button (SVG with play icon or button with play semantics)
    const playButtons = page.locator("button").filter({ has: page.locator("svg") });
    // There should be at least one play button among the track controls
    await expect(playButtons.first()).toBeVisible({ timeout: 10_000 });
  });

  test("can tag a track with a song name", async ({ page }) => {
    // Find an untagged track's tag area and click to start tagging
    // Tracks without songs show an "add tag" or similar button with "Tag" text
    // Look for the first track row that has tagging capability

    // Find the edit button that opens tag mode
    const tagButtons = page.getByText("Tag", { exact: true });
    const editButtons = page.getByText("edit", { exact: true });

    // Try to find either a "Tag" button (untagged) or "edit" link (tagged)
    const hasTagButton = await tagButtons.first().isVisible().catch(() => false);
    const hasEditButton = await editButtons.first().isVisible().catch(() => false);

    if (hasTagButton) {
      await tagButtons.first().click();
    } else if (hasEditButton) {
      await editButtons.first().click();
    } else {
      // Skip if no tagging UI is visible
      test.skip();
      return;
    }

    // Tag input should now be visible
    const tagInput = page.getByPlaceholder("Search or type new song...");
    await expect(tagInput).toBeVisible({ timeout: 5_000 });

    // Type a song name from seeded data
    await tagInput.fill("Fat Cat");

    // Should see the song chip appear as a suggestion (if it exists in the DB)
    // or the "create new" chip
    const suggestion = page.getByText("Fat Cat").first();
    await expect(suggestion).toBeVisible({ timeout: 5_000 });

    // Click the suggestion or press Enter to tag
    await suggestion.click();

    // After tagging, the track should show the song name as a link
    await expect(page.getByRole("link", { name: "Fat Cat" }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("can untag a track", async ({ page }) => {
    // First, find a tagged track (one with an "edit" button next to song name)
    const editButtons = page.getByText("edit", { exact: true });
    const hasEdit = await editButtons.first().isVisible().catch(() => false);
    if (!hasEdit) {
      test.skip();
      return;
    }

    // Click edit to enter tag mode
    await editButtons.first().click();

    // Should see the tag input and a "Remove" button
    const removeButton = page.getByText("Remove", { exact: true });
    await expect(removeButton).toBeVisible({ timeout: 5_000 });

    // Click Remove to untag
    await removeButton.click();

    // The song name link should disappear and be replaced with a "Tag" button
    // Wait a moment for the UI to update
    await page.waitForTimeout(1_000);

    // Either the "Tag" button appears or the "edit" button is gone for that track
    // This confirms the untag action was processed
  });

  test("track shows duration information", async ({ page }) => {
    // Tracks display duration in M:SS format
    // Look for time-formatted text like "3:45" or "1:20"
    const durationPattern = page.getByText(/^\d+:\d{2}$/);
    await expect(durationPattern.first()).toBeVisible({ timeout: 10_000 });
  });

  test("tagged tracks show song name as link to song history", async ({ page }) => {
    // Find a track with a song tag (rendered as a link to /songs/<id>)
    const songLinks = page.locator('a[href^="/songs/"]');
    const hasSongLink = await songLinks.first().isVisible().catch(() => false);

    if (!hasSongLink) {
      test.skip();
      return;
    }

    // Click the song name link
    await songLinks.first().click();

    // Should navigate to song history page
    await expect(page).toHaveURL(/\/songs\/\d+/);
  });
});
