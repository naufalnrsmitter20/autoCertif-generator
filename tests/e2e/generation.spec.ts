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
  await page.goto("/login", { waitUntil: "networkidle" });
  await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin(\/batches)?/, { timeout: 60000 });
}

test.describe("Certificate Generation Flow (Phase 9)", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  test("generation section renders with prerequisites checklist and blocks generation when prerequisites are missing", async ({
    page,
  }) => {
    test.setTimeout(120000);
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD credentials are not configured"
    );

    const batchName = `Generation E2E Incomplete Batch ${Date.now()}`;

    // 1. Login with retry on cold start
    await loginAsAdmin(page, adminEmail!, adminPassword!);

    // 2. Create fresh batch
    await page.goto("/admin/batches/new");
    await page.fill("#batch-name", batchName);
    await page.click('[data-testid="submit-create-batch"]');

    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/admin/batches/") &&
        url.pathname !== "/admin/batches/new",
      { timeout: 60000 }
    );
    const batchUrl = page.url();
    const batchId = batchUrl.split("/").pop()!;

    // 3. Verify Generation Section is present
    const genSection = page.locator('[data-testid="generation-section"]');
    await expect(genSection).toBeVisible();

    // 4. Verify Generate button is disabled because prerequisites (template, position, participants) are missing
    const genButton = page.locator('[data-testid="generate-certificates-button"]');
    await expect(genButton).toBeDisabled();

    // 5. Cleanup batch from DB with retry
    const pool = getTestPgPool();
    try {
      await queryWithRetry(pool, 'DELETE FROM certificate_batches WHERE id = $1', [batchId]);
    } finally {
      await pool.end();
    }
  });

  test("preflight strictly blocks generation with error message when real production font is NOT CONFIGURED", async ({
    page,
  }) => {
    test.setTimeout(120000);
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD credentials are not configured"
    );

    const batchName = `Generation Font Guard Batch ${Date.now()}`;
    const pool = getTestPgPool();

    let batchId: string | null = null;
    let templateId: string | null = null;
    let participantId: string | null = null;

    try {
      // 1. Setup in DB: template without registered production font, plus participant
      const tRes = await queryWithRetry(
        pool,
        `INSERT INTO certificate_templates (
          id, name, "fileType", "sourceFilePath", "pageWidth", "pageHeight",
          "namePlacement", "fontAssetPath", "fontConfig", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'E2E Template', 'PDF', 'templates/dummy.pdf', 842, 595,
          $2, 'unregistered-prod-font', $3, NOW(), NOW()
        ) RETURNING id`,
        [
          `tpl-${Date.now()}`,
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

      const bRes = await queryWithRetry(
        pool,
        `INSERT INTO certificate_batches (id, name, status, "templateId", "createdAt", "updatedAt")
         VALUES ($1, $2, 'DRAFT', $3, NOW(), NOW()) RETURNING id`,
        [`batch-${Date.now()}`, batchName, templateId]
      );
      batchId = bRes.rows[0].id;

      const pRes = await queryWithRetry(
        pool,
        `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Budi Santoso', NOW(), NOW()) RETURNING id`,
        [`part-${Date.now()}`, batchId]
      );
      participantId = pRes.rows[0].id;

      // 2. Login with retry on cold start
      await loginAsAdmin(page, adminEmail!, adminPassword!);

      // 3. Navigate to batch detail page
      await page.goto(`/admin/batches/${batchId}`);

      // 4. Verify Generate button is enabled (has template, position, and 1 participant)
      const genButton = page.locator('[data-testid="generate-certificates-button"]');
      await expect(genButton).toBeEnabled();

      // 5. Click Generate Certificates
      await genButton.click();

      // 6. Verify preflight error banner is displayed
      const errorBanner = page.locator('[data-testid="generation-error-banner"]');
      await expect(errorBanner).toBeVisible({ timeout: 45000 });
      await expect(errorBanner).toContainText("Font asset configuration error");
      await expect(errorBanner).toContainText("Real production font remains NOT CONFIGURED");

      // 7. Verify batch remains in DRAFT status in DB
      const checkRes = await queryWithRetry(
        pool,
        'SELECT status, "currentGenerationKey" FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      expect(checkRes.rows[0].status).toBe("DRAFT");
      expect(checkRes.rows[0].currentGenerationKey).toBeNull();
    } finally {
      if (participantId) {
        await queryWithRetry(pool, 'DELETE FROM participants WHERE id = $1', [participantId]).catch(() => {});
      }
      if (batchId) {
        await queryWithRetry(pool, 'DELETE FROM certificate_batches WHERE id = $1', [batchId]).catch(() => {});
      }
      if (templateId) {
        await queryWithRetry(pool, 'DELETE FROM certificate_templates WHERE id = $1', [templateId]).catch(() => {});
      }
      await pool.end();
    }
  });
});
