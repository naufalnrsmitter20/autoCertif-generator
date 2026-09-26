import { test, expect } from "@playwright/test";

test.describe("Certificate Batch CRUD Flow", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  test("complete batch lifecycle: create, detail, edit name, soft-delete, and not-found verification", async ({
    page,
  }) => {
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD environment credentials are not configured in this environment"
    );

    const initialBatchName = `E2E Test Batch ${Date.now()}`;
    const updatedBatchName = `${initialBatchName} Renamed`;

    // 1. Login as ADMIN
    await page.goto("/login");
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');

    // 2. Verified land on /admin/batches
    await expect(page).toHaveURL(/\/admin(\/batches)?/, { timeout: 15000 });
    await expect(page.locator("header")).toContainText("AutoCertif");
    await expect(page.locator("header")).toContainText("Batches");
    await expect(page.locator("header")).toContainText("ADMIN");

    // 3. Navigate to Create Batch page
    await page.goto("/admin/batches/new");
    await expect(page.locator("h1")).toContainText("Create Certificate Batch");

    // 4. Test client/server validation feedback for empty name
    await page.click('[data-testid="submit-create-batch"]');
    const nameError = page.locator('[data-testid="batch-name-error"]');
    await expect(nameError).toBeVisible({ timeout: 5000 });
    await expect(nameError).toContainText("Batch name is required");

    // 5. Fill valid batch name and submit
    await page.fill("#batch-name", initialBatchName);
    await page.click('[data-testid="submit-create-batch"]');

    // 6. Wait for redirect away from /admin/batches/new to /admin/batches/[batchId]
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/admin/batches/") &&
        url.pathname !== "/admin/batches/new",
      { timeout: 15000 }
    );
    const batchDetailUrl = page.url();

    // 7. Verify batch details: name, DRAFT status, unconfigured template
    await expect(
      page.locator('[data-testid="batch-detail-title"]')
    ).toContainText(initialBatchName, { timeout: 15000 });
    await expect(
      page.locator('[data-testid="batch-status-badge"]')
    ).toContainText("Draft");
    await expect(
      page.locator('[data-testid="batch-template-status"]')
    ).toContainText("Not configured");

    // 8. Edit batch name
    await page.fill("#edit-batch-name", updatedBatchName);
    await page.click('[data-testid="submit-edit-batch"]');

    // 9. Verify success notification and updated title
    const successAlert = page.locator('[data-testid="edit-batch-success"]');
    await expect(successAlert).toBeVisible({ timeout: 10000 });
    await expect(successAlert).toContainText("Batch name updated successfully.");
    await expect(
      page.locator('[data-testid="batch-detail-title"]')
    ).toContainText(updatedBatchName);

    // 10. Navigate to batch list and verify updated batch appears
    await page.goto("/admin/batches");
    await expect(page.locator('[data-testid="batches-table"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("body")).toContainText(updatedBatchName);

    // 11. Return to batch detail to test soft-delete
    await page.goto(batchDetailUrl);
    await expect(
      page.locator('[data-testid="batch-detail-title"]')
    ).toContainText(updatedBatchName, { timeout: 15000 });

    // 12. Trigger soft-delete flow with confirmation
    await page.click('[data-testid="open-delete-dialog-button"]');
    const deleteContainer = page.locator(
      '[data-testid="delete-confirmation-container"]'
    );
    await expect(deleteContainer).toBeVisible();
    await expect(deleteContainer).toContainText(
      `Are you sure you want to delete ${updatedBatchName}?`
    );

    // 13. Confirm deletion
    await page.click('[data-testid="confirm-delete-batch-button"]');

    // 14. Redirected back to batch list; verify deleted batch has disappeared
    await page.waitForURL(
      (url) => url.pathname === "/admin/batches",
      { timeout: 15000 }
    );
    await expect(page.locator("body")).not.toContainText(updatedBatchName);

    // 15. Directly navigate to deleted batch detail and verify 404 Not Found state
    await page.goto(batchDetailUrl);
    await expect(
      page.locator('[data-testid="batch-not-found"]')
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="batch-not-found"]')).toContainText(
      "Batch Not Found"
    );
  });

  test("responsive viewport verification: desktop and small mobile layout without horizontal overflow", async ({
    page,
  }) => {
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD environment credentials are not configured in this environment"
    );

    // Set mobile viewport (iPhone SE width: 375px)
    await page.setViewportSize({ width: 375, height: 667 });

    // Login as ADMIN
    await page.goto("/login");
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => url.pathname.startsWith("/admin"), { timeout: 15000 });

    // Check no horizontal scroll overflow on mobile batches page
    const mobileBatchesOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(mobileBatchesOverflow).toBe(false);

    // Check no horizontal scroll overflow on mobile create batch page
    await page.goto("/admin/batches/new");
    const mobileNewBatchOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(mobileNewBatchOverflow).toBe(false);

    // Desktop viewport (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin/batches");
    const desktopBatchesOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(desktopBatchesOverflow).toBe(false);
  });
});
