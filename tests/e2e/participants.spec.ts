import { test, expect } from "@playwright/test";
import path from "path";
import { Pool } from "pg";

async function cleanupTestBatch(batchId: string) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  const cleanupErrors: unknown[] = [];

  const remove = async (sql: string) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pool.query(sql, [batchId]);
        return;
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const message = error instanceof Error ? error.message : "";
        const transient = code === "EAI_AGAIN" || code === "ECONNRESET" ||
          code === "ETIMEDOUT" || message.includes("EAI_AGAIN");
        if (!transient || attempt === 3) throw error;
        console.warn(`Transient cleanup database connection failure; retrying (${attempt}/2).`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  };

  try { await remove(`DELETE FROM participants WHERE "batchId" = $1`); }
  catch (error) { cleanupErrors.push(error); }
  try { await remove(`DELETE FROM certificate_batches WHERE id = $1`); }
  catch (error) { cleanupErrors.push(error); }
  try { await pool.end(); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Participant test cleanup failed");
}

/**
 * Phase 6 E2E: CSV Import & Participant CRUD
 *
 * Uses test-owned unique batch identity. Cleans up only exact resources
 * created by this test run (by targeted ID). No broad deleteMany.
 *
 * CSV fixture: tests/fixtures/participants-e2e.csv
 * Rows:
 *   Row 2: Naufal Nabil Ramadhan         (valid)
 *   Row 3: "Putri, Ananda"               (valid, quoted comma)
 *   Row 4:   Budi    Santoso             (valid after normalization)
 *   Row 5: Naufal Nabil Ramadhan         (valid, duplicate warning)
 *
 * Expected after import: 4 participants persisted (duplicates are allowed).
 */
test.describe("Phase 6 — CSV Import & Participant CRUD", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  let createdBatchId: string | null = null;

  // Cleanup: remove only the exact test-owned batch and its participants
  test.afterAll(async () => {
    if (!createdBatchId) return;
    await cleanupTestBatch(createdBatchId);
  });

  test("complete CSV import and participant CRUD flow", async ({ page }) => {
    test.setTimeout(120000);
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set for Phase 6 E2E"
    );

    const batchName = `E2E Phase 6 Participants ${Date.now()}`;
    const csvFixturePath = path.resolve(
      __dirname,
      "../fixtures/participants-e2e.csv"
    );

    // 1. Login
    await page.goto("/login");
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/admin/, { timeout: 30000 });

    // 2. Create a new DRAFT batch
    await page.goto("/admin/batches/new");
    await page.fill("#batch-name", batchName);
    await page.click('[data-testid="submit-create-batch"]');
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/admin/batches/") &&
        url.pathname !== "/admin/batches/new",
      { timeout: 15000 }
    );

    // Extract batchId from URL
    const batchDetailUrl = page.url();
    createdBatchId = batchDetailUrl.split("/admin/batches/")[1].split("/")[0];
    expect(createdBatchId).toBeTruthy();

    // 3. Verify batch is DRAFT
    await expect(page.locator('[data-testid="batch-status-badge"]')).toContainText("Draft");

    // 4. Navigate to participants management via "Manage Participants" link
    const manageParticipantsLink = page.locator('[data-testid="manage-participants-link"]');
    await expect(manageParticipantsLink).toBeVisible({ timeout: 15000 });
    await manageParticipantsLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/batches/${createdBatchId}/participants`),
      { timeout: 30000 }
    );

    // 5. Select CSV file — preview appears BEFORE import
    const fileInput = page.locator('[data-testid="csv-file-input"]');
    await fileInput.setInputFiles(csvFixturePath);

    // Wait for preview to appear
    await expect(page.locator('[data-testid="csv-preview-container"]')).toBeVisible({
      timeout: 5000,
    });

    // 6. Verify preview summary counts
    // 4 data rows, 0 invalid (empty lines skipped by Papa Parse), 1 duplicate warning
    const previewText = await page.locator('[data-testid="csv-preview-container"]').textContent();
    expect(previewText).toContain("4"); // total rows
    expect(previewText).toContain("Duplicate"); // duplicate warning present

    // 7. Verify duplicate warning row is visually distinct (amber, not red)
    const duplicateWarnings = page.locator('[data-testid="duplicate-warning"]');
    await expect(duplicateWarnings.first()).toBeVisible();

    // 8. Verify confirm button is enabled (duplicates don't block import)
    const confirmBtn = page.locator('[data-testid="confirm-import-button"]');
    await expect(confirmBtn).toBeEnabled();

    // 9. Confirm import
    await confirmBtn.click();

    // 10. Wait for success message
    await expect(page.locator('[data-testid="import-success"]')).toBeVisible({
      timeout: 10000,
    });

    // 11. Verify participants appear in the list (page should refresh)
    await expect(page.locator('[data-testid="participants-table"]')).toBeVisible({
      timeout: 10000,
    });

    // 12. Verify all 4 valid rows are persisted (including duplicate)
    const participantNames = page.locator('[data-testid^="participant-name-"]');
    await expect(participantNames).toHaveCount(4, { timeout: 10000 });

    // 13. Verify "Naufal Nabil Ramadhan" appears twice (duplicate imported)
    const allNames = await participantNames.allTextContents();
    const naufalCount = allNames.filter((n) => n === "Naufal Nabil Ramadhan").length;
    expect(naufalCount).toBe(2);

    // 14. Verify "Putri, Ananda" is correctly persisted (quoted comma)
    expect(allNames).toContain("Putri, Ananda");

    // 15. Verify "Budi Santoso" normalized correctly (collapsed whitespace)
    expect(allNames).toContain("Budi Santoso");

    // 16. Manually add a participant
    const addNameInput = page.locator('[data-testid="add-participant-name-input"]');
    await addNameInput.fill("  Siti   Rahayu  ");
    await page.click('[data-testid="submit-add-participant"]');

    await expect(page.locator('[data-testid="add-participant-success"]')).toBeVisible({
      timeout: 15000,
    });

    // 17. Wait for list to refresh and verify new participant
    await expect(
      page.locator('[data-testid^="participant-name-"]')
    ).toHaveCount(5, { timeout: 10000 });
    await expect(page.getByText("Siti Rahayu")).toBeVisible({ timeout: 10000 });

    // 18. Edit a participant name
    // Get first Edit button
    const firstEditBtn = page.locator('[data-testid^="edit-button-"]').first();
    await firstEditBtn.click();

    // Find the edit input
    const editInput = page.locator('[data-testid^="edit-name-input-"]').first();
    await editInput.clear();
    await editInput.fill("Naufal Nabil Ramadhan Edited");

    // Find and click Save
    const saveBtn = page.locator('[data-testid^="save-edit-button-"]').first();
    await saveBtn.click();

    // 19. Wait for refresh and verify edited value appears
    await expect(
      page.getByText("Naufal Nabil Ramadhan Edited")
    ).toBeVisible({ timeout: 10000 });

    // 20. Soft-delete a participant
    const firstDeleteBtn = page.locator('[data-testid^="delete-button-"]').first();
    await firstDeleteBtn.click();

    // Confirm delete
    const confirmDeleteBtn = page.locator('[data-testid^="confirm-delete-button-"]').first();
    await expect(confirmDeleteBtn).toBeVisible({ timeout: 3000 });
    await confirmDeleteBtn.click();

    // 21. Wait for refresh and verify participant count decreased
    // Started with 5 (4 imported + 1 manual), deleted 1 → 4 remain
    await expect(
      page.locator('[data-testid^="participant-name-"]')
    ).toHaveCount(4, { timeout: 10000 });

    // 22. Reload page and verify state persists
    await page.reload();
    await expect(page).toHaveURL(
      new RegExp(`/admin/batches/${createdBatchId}/participants`),
      { timeout: 30000 }
    );
    const persistedCount = await page
      .locator('[data-testid^="participant-name-"]')
      .count();
    expect(persistedCount).toBe(4);

    // 23. Verify batch status remains DRAFT throughout
    await page.goto(`/admin/batches/${createdBatchId}`);
    await expect(page.locator('[data-testid="batch-status-badge"]')).toContainText("Draft");
  });

  test("responsive layout: no horizontal overflow on mobile and desktop", async ({
    page,
  }) => {
    test.setTimeout(90000);
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set"
    );

    // Login
    await page.goto("/login");
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/admin/, { timeout: 30000 });

    let responsiveBatchId: string | null = null;
    let primaryError: unknown;
    try {
      await page.goto("/admin/batches/new");
      await page.fill("#batch-name", `Responsive Participants ${Date.now()}`);
      await page.click('[data-testid="submit-create-batch"]');
      await page.waitForURL(
        (url) => url.pathname.startsWith("/admin/batches/") && url.pathname !== "/admin/batches/new"
      );
      responsiveBatchId = page.url().split("/admin/batches/")[1].split("/")[0];

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/admin/batches");
      const mobileOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(mobileOverflow).toBe(false);

      await page.goto(`/admin/batches/${responsiveBatchId}/participants`);
      const participantsMobileOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(participantsMobileOverflow).toBe(false);

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/admin/batches");
      const desktopOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(desktopOverflow).toBe(false);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (responsiveBatchId) {
        try {
          await cleanupTestBatch(responsiveBatchId);
        } catch (cleanupError) {
          throw new AggregateError(
            primaryError ? [primaryError, cleanupError] : [cleanupError],
            "Responsive participant test cleanup failed"
          );
        }
      }
    }
  });
});
