import { test, expect, Page } from "@playwright/test";
import { Pool, QueryResult, QueryResultRow } from "pg";

function getTestPgPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15000,
  });
}

async function queryWithRetry<R extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  text: string,
  params: unknown[] = [],
  retries = 3
): Promise<QueryResult<R>> {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query(text, params);
    } catch (err: unknown) {
      if (i === retries - 1) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorCode = (err as { code?: string })?.code;
      if (
        errorCode === "EAI_AGAIN" ||
        errorMsg.includes("EAI_AGAIN") ||
        errorMsg.includes("timeout")
      ) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Query retry exhaustion");
}

async function loginAsAdmin(page: Page, email: string, pass: string) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin(\/batches)?/, { timeout: 60000 });
}

test.describe("Generation Management UI & Actions (Phase 10)", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  test("ADMIN can review generation results, filter by status, see safe failure reasons, and view whole-batch dialog", async ({
    page,
  }) => {
    test.setTimeout(240000);
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD credentials are not configured"
    );

    const timestamp = Date.now();
    const batchName = `E2E Gen Management Batch ${timestamp}`;
    const pool = getTestPgPool();

    let batchId: string | null = null;
    let templateId: string | null = null;
    let part1Id: string | null = null;
    let part2Id: string | null = null;

    try {
      // 1. Setup seed data in DB
      const tRes = await queryWithRetry(
        pool,
        `INSERT INTO certificate_templates (
          id, name, "fileType", "sourceFilePath", "pageWidth", "pageHeight",
          "namePlacement", "fontAssetPath", "fontConfig", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'E2E Template', 'PDF', 'templates/dummy.pdf', 842, 595,
          $2, 'test-font', $3, NOW(), NOW()
        ) RETURNING id`,
        [
          `tpl-mgmt-${timestamp}`,
          JSON.stringify({ xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.5, alignment: "center" }),
          JSON.stringify({
            fontSize: 28,
            minFontSize: 14,
            lineHeightMultiplier: 1.2,
            textColor: { r: 0, g: 0, b: 0 },
            stepSize: 1,
          }),
        ]
      );
      templateId = tRes.rows[0].id;

      const initialGenKey = `key-${timestamp}`;
      const bRes = await queryWithRetry(
        pool,
        `INSERT INTO certificate_batches (
          id, name, status, "templateId", "currentGenerationKey", "createdAt", "updatedAt"
        ) VALUES ($1, $2, 'GENERATED', $3, $4, NOW(), NOW()) RETURNING id`,
        [`batch-mgmt-${timestamp}`, batchName, templateId, initialGenKey]
      );
      batchId = bRes.rows[0].id;

      // Participant 1: GENERATED
      const p1Res = await queryWithRetry(
        pool,
        `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Budi Santoso', NOW(), NOW()) RETURNING id`,
        [`part-1-${timestamp}`, batchId]
      );
      part1Id = p1Res.rows[0].id;

      await queryWithRetry(
        pool,
        `INSERT INTO certificates (
          id, "participantId", "batchId", status, "generationKey", "generatedFilePath", "isStale", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, 'GENERATED', $4, 'certificates/dummy-path.pdf', false, NOW(), NOW())`,
        [`cert-1-${timestamp}`, part1Id, batchId, initialGenKey]
      );

      // Participant 2: FAILED with safe error
      const p2Res = await queryWithRetry(
        pool,
        `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Siti Rahmawati Overflow Name', NOW(), NOW()) RETURNING id`,
        [`part-2-${timestamp}`, batchId]
      );
      part2Id = p2Res.rows[0].id;

      await queryWithRetry(
        pool,
        `INSERT INTO certificates (
          id, "participantId", "batchId", status, "generationKey", "generationError", "isStale", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, 'FAILED', $4, 'NAME_DOES_NOT_FIT: SINGLE_WORD_OVERFLOW', false, NOW(), NOW())`,
        [`cert-2-${timestamp}`, part2Id, batchId, initialGenKey]
      );

      // 2. Login as admin
      await loginAsAdmin(page, adminEmail!, adminPassword!);

      // 3. Navigate to batch detail page and verify "Manage Generation" link
      await page.goto(`/admin/batches/${batchId}`);
      const manageLink = page.locator('[data-testid="manage-generation-link"]');
      await expect(manageLink).toBeVisible({ timeout: 30000 });
      await manageLink.click();

      // 4. Verify landing on /generation page
      await expect(page).toHaveURL(new RegExp(`/admin/batches/${batchId}/generation`), { timeout: 60000 });
      await expect(page.locator('[data-testid="generation-page-title"]')).toBeVisible({ timeout: 60000 });

      // 5. Verify summary metrics
      await expect(page.locator('[data-testid="summary-total"]')).toHaveText("2");
      await expect(page.locator('[data-testid="summary-generated"]')).toHaveText("1");
      await expect(page.locator('[data-testid="summary-failed"]')).toHaveText("1");
      await expect(page.locator('[data-testid="summary-in-progress"]')).toHaveText("0");

      // 6. Verify table rows
      const row1 = page.locator(`[data-testid="participant-row-${part1Id}"]`);
      const row2 = page.locator(`[data-testid="participant-row-${part2Id}"]`);
      await expect(row1).toBeVisible();
      await expect(row2).toBeVisible();

      // Row 1 (GENERATED) has Regenerate button
      await expect(page.locator(`[data-testid="regenerate-button-${part1Id}"]`)).toBeVisible();

      // Row 2 (FAILED) has Retry button and safe failure reason
      await expect(page.locator(`[data-testid="retry-button-${part2Id}"]`)).toBeVisible();
      const failReason = page.locator(`[data-testid="failure-reason-${part2Id}"]`);
      await expect(failReason).toBeVisible();
      await expect(failReason).toContainText("Name could not fit safely");

      // 7. Verify Filter tabs
      await page.click('[data-testid="filter-failed"]');
      await expect(row2).toBeVisible();
      await expect(row1).not.toBeVisible();

      await page.click('[data-testid="filter-generated"]');
      await expect(row1).toBeVisible();
      await expect(row2).not.toBeVisible();

      await page.click('[data-testid="filter-all"]');
      await expect(row1).toBeVisible();
      await expect(row2).toBeVisible();

      // 8. Verify Regenerate Whole Batch confirmation dialog
      const openDialogBtn = page.locator('[data-testid="open-regenerate-batch-dialog-button"]');
      await expect(openDialogBtn).toBeVisible();
      await openDialogBtn.click();

      const confirmContainer = page.locator('[data-testid="regenerate-batch-confirmation-container"]');
      await expect(confirmContainer).toBeVisible();

      // Cancel dialog
      await page.click('[data-testid="cancel-regenerate-batch-button"]');
      await expect(confirmContainer).not.toBeVisible();

      // 9. Verify responsive layout on mobile viewport (375x667) has zero horizontal overflow
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(500);

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll).toBe(false);
    } finally {
      if (batchId) {
        await queryWithRetry(pool, 'DELETE FROM certificates WHERE "batchId" = $1', [batchId]).catch(() => {});
        await queryWithRetry(pool, 'DELETE FROM participants WHERE "batchId" = $1', [batchId]).catch(() => {});
        await queryWithRetry(pool, 'DELETE FROM certificate_batches WHERE id = $1', [batchId]).catch(() => {});
      }
      if (templateId) {
        await queryWithRetry(pool, 'DELETE FROM certificate_templates WHERE id = $1', [templateId]).catch(() => {});
      }
      await pool.end();
    }
  });
});
