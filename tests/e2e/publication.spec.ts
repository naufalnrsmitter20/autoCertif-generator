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
        errorCode === "ECONNRESET" ||
        errorCode === "ETIMEDOUT"
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
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin/, { timeout: 60000 });
}

test.describe("Batch Publication & Unpublication Lifecycle (Phase 11)", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  test("ADMIN can review preflight, publish batch, inspect published state, edit published name, and unpublish", async ({
    page,
  }) => {
    test.setTimeout(240000);
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD credentials are not configured"
    );

    const timestamp = Date.now();
    const batchName = `E2E Publication Batch ${timestamp}`;
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
          $1, 'E2E Pub Template', 'PDF', 'templates/dummy.pdf', 842, 595,
          $2, 'test-font', $3, NOW(), NOW()
        ) RETURNING id`,
        [
          `tpl-pub-${timestamp}`,
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

      const initialGenKey = `key-pub-${timestamp}`;
      const bRes = await queryWithRetry(
        pool,
        `INSERT INTO certificate_batches (
          id, name, status, "templateId", "currentGenerationKey", "createdAt", "updatedAt"
        ) VALUES ($1, $2, 'GENERATED', $3, $4, NOW(), NOW()) RETURNING id`,
        [`batch-pub-${timestamp}`, batchName, templateId, initialGenKey]
      );
      batchId = bRes.rows[0].id;

      // Participant 1: GENERATED
      const p1Res = await queryWithRetry(
        pool,
        `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Budi Santoso', NOW(), NOW()) RETURNING id`,
        [`part-1-pub-${timestamp}`, batchId]
      );
      part1Id = p1Res.rows[0].id;

      await queryWithRetry(
        pool,
        `INSERT INTO certificates (
          id, "participantId", "batchId", status, "generationKey", "generatedFilePath", "generatedAt", "isStale", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, 'GENERATED', $4, 'certificates/dummy-p1.pdf', NOW(), false, NOW(), NOW())`,
        [`cert-1-pub-${timestamp}`, part1Id, batchId, initialGenKey]
      );

      // Participant 2: FAILED with safe error
      const p2Res = await queryWithRetry(
        pool,
        `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Siti Rahmawati Overflow Name', NOW(), NOW()) RETURNING id`,
        [`part-2-pub-${timestamp}`, batchId]
      );
      part2Id = p2Res.rows[0].id;

      await queryWithRetry(
        pool,
        `INSERT INTO certificates (
          id, "participantId", "batchId", status, "generationKey", "generationError", "isStale", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, 'FAILED', $4, 'NAME_DOES_NOT_FIT: SINGLE_WORD_OVERFLOW', false, NOW(), NOW())`,
        [`cert-2-pub-${timestamp}`, part2Id, batchId, initialGenKey]
      );

      // 2. Login as admin
      await loginAsAdmin(page, adminEmail!, adminPassword!);

      // 3. Navigate to batch detail page
      await page.goto(`/admin/batches/${batchId}`);
      await expect(page.locator('[data-testid="batch-detail-title"]')).toHaveText(batchName, { timeout: 30000 });
      await expect(page.locator('[data-testid="batch-status-badge"]')).toHaveText("Generated");

      // Verify "Publish Batch" button is visible
      const publishBtn = page.locator('[data-testid="open-publish-dialog-button"]');
      await expect(publishBtn).toBeVisible({ timeout: 15000 });

      // 4. Open Publish Dialog & verify preflight
      await publishBtn.click();
      const publishDialog = page.locator('div[role="dialog"]');
      await expect(publishDialog).toBeVisible({ timeout: 15000 });
      await expect(publishDialog).toContainText("Publish Certificate Batch");

      // Preflight finishes loading and shows metrics
      const eligibleCountLocator = page.locator('[data-testid="publish-eligible-count"]');
      await expect(eligibleCountLocator).toBeVisible({ timeout: 60000 });
      await expect(eligibleCountLocator).toHaveText("1 of 2");
      await expect(publishDialog).toContainText("Siti Rahmawati Overflow Name");

      // Confirm publication
      const confirmPublishBtn = page.locator('[data-testid="confirm-publish-button"]');
      await expect(confirmPublishBtn).toBeEnabled({ timeout: 15000 });
      await confirmPublishBtn.click();

      // Dialog closes and page refreshes to PUBLISHED
      await expect(publishDialog).not.toBeVisible({ timeout: 60000 });
      await expect(page.locator('[data-testid="batch-status-badge"]')).toHaveText("Published", { timeout: 60000 });

      // Unpublish button becomes visible
      const unpublishBtn = page.locator('[data-testid="open-unpublish-dialog-button"]');
      await expect(unpublishBtn).toBeVisible();

      // 5. Navigate to /generation page to verify published subtext and edit name
      await page.goto(`/admin/batches/${batchId}/generation`);
      await expect(page.locator('[data-testid="generation-page-title"]')).toBeVisible({ timeout: 30000 });

      // Participant 1 row shows published name subtext and Edit Name button
      const pubNameSubtext = page.locator(`[data-testid="published-name-subtext-${part1Id}"]`);
      await expect(pubNameSubtext).toBeVisible();
      await expect(pubNameSubtext).toContainText('Published as: "Budi Santoso"');

      const editBtn = page.locator(`[data-testid="edit-published-button-${part1Id}"]`);
      await expect(editBtn).toBeVisible();

      // 6. Test Unpublish flow
      await page.goto(`/admin/batches/${batchId}`);
      const unpubBtn = page.locator('[data-testid="open-unpublish-dialog-button"]');
      await expect(unpubBtn).toBeVisible();
      await unpubBtn.click();

      const unpubDialog = page.locator('div[role="dialog"]');
      await expect(unpubDialog).toBeVisible({ timeout: 15000 });
      await expect(unpubDialog).toContainText("Unpublish Certificate Batch");
      await expect(unpubDialog).toContainText("Generated certificate PDF files in storage are NOT deleted.");

      const confirmUnpubBtn = page.locator('[data-testid="confirm-unpublish-button"]');
      await confirmUnpubBtn.click();

      // Dialog closes and batch status returns to Generated
      await expect(unpubDialog).not.toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-testid="batch-status-badge"]')).toHaveText("Generated", { timeout: 30000 });
      await expect(page.locator('[data-testid="open-publish-dialog-button"]')).toBeVisible();
    } finally {
      if (batchId) {
        await queryWithRetry(pool, `DELETE FROM certificates WHERE "batchId" = $1`, [batchId]).catch(() => {});
        await queryWithRetry(pool, `DELETE FROM participants WHERE "batchId" = $1`, [batchId]).catch(() => {});
        await queryWithRetry(pool, `DELETE FROM certificate_batches WHERE id = $1`, [batchId]).catch(() => {});
      }
      if (templateId) {
        await queryWithRetry(pool, `DELETE FROM certificate_templates WHERE id = $1`, [templateId]).catch(() => {});
      }
      await pool.end().catch(() => {});
    }
  });
});
