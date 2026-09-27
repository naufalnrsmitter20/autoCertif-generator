import { test, expect } from "@playwright/test";
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

test.describe("Public Certificate Search Flow (Phase 12)", () => {
  const timestamp = Date.now();
  const pool = getTestPgPool();

  let pubBatchId: string | null = null;
  let unpubBatchId: string | null = null;
  let templateId: string | null = null;

  test.beforeAll(async () => {
    // 1. Create Template
    const tRes = await queryWithRetry(
      pool,
      `INSERT INTO certificate_templates (
        id, name, "fileType", "sourceFilePath", "pageWidth", "pageHeight",
        "createdAt", "updatedAt"
      ) VALUES ($1, 'E2E Search Template', 'PDF', 'templates/dummy.pdf', 842, 595, NOW(), NOW()) RETURNING id`,
      [`tpl-e2e-search-${timestamp}`]
    );
    templateId = tRes.rows[0].id;

    // 2. Create Published Batch
    const b1Res = await queryWithRetry(
      pool,
      `INSERT INTO certificate_batches (
        id, name, status, "templateId", "publishedAt", "createdAt", "updatedAt"
      ) VALUES ($1, 'E2E Search Published Batch', 'PUBLISHED', $2, NOW(), NOW(), NOW()) RETURNING id`,
      [`batch-e2e-pub-${timestamp}`, templateId]
    );
    pubBatchId = b1Res.rows[0].id;

    // 3. Create Unpublished Batch
    const b2Res = await queryWithRetry(
      pool,
      `INSERT INTO certificate_batches (
        id, name, status, "templateId", "publishedAt", "createdAt", "updatedAt"
      ) VALUES ($1, 'E2E Search Unpublished Batch', 'GENERATED', $2, NULL, NOW(), NOW()) RETURNING id`,
      [`batch-e2e-unpub-${timestamp}`, templateId]
    );
    unpubBatchId = b2Res.rows[0].id;

    // Participant 1: "Naufal Nabil Ramadhan" (Published Batch)
    const p1 = await queryWithRetry(
      pool,
      `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Naufal Nabil Ramadhan', NOW(), NOW()) RETURNING id`,
      [`p1-search-${timestamp}`, pubBatchId]
    );
    await queryWithRetry(
      pool,
      `INSERT INTO certificates (
        id, "participantId", "batchId", status, "publishedName", "publishedFilePath", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'GENERATED', 'Naufal Nabil Ramadhan', 'certificates/p1.pdf', NOW(), NOW())`,
      [`c1-search-${timestamp}`, p1.rows[0].id, pubBatchId]
    );

    // Participant 2 & 3: Duplicate names "Budi Santoso" (Published Batch)
    const p2 = await queryWithRetry(
      pool,
      `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Budi Santoso', NOW(), NOW()) RETURNING id`,
      [`p2-search-${timestamp}`, pubBatchId]
    );
    await queryWithRetry(
      pool,
      `INSERT INTO certificates (
        id, "participantId", "batchId", status, "publishedName", "publishedFilePath", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'GENERATED', 'Budi Santoso', 'certificates/p2.pdf', NOW(), NOW())`,
      [`c2-search-${timestamp}`, p2.rows[0].id, pubBatchId]
    );

    const p3 = await queryWithRetry(
      pool,
      `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Budi Santoso', NOW(), NOW()) RETURNING id`,
      [`p3-search-${timestamp}`, pubBatchId]
    );
    await queryWithRetry(
      pool,
      `INSERT INTO certificates (
        id, "participantId", "batchId", status, "publishedName", "publishedFilePath", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'GENERATED', 'Budi Santoso', 'certificates/p3.pdf', NOW(), NOW())`,
      [`c3-search-${timestamp}`, p3.rows[0].id, pubBatchId]
    );

    // Participant 4: Replacement in progress (name changed to 'Edited New Name', publishedName is 'Old Published Name')
    const p4 = await queryWithRetry(
      pool,
      `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Edited New Name', NOW(), NOW()) RETURNING id`,
      [`p4-search-${timestamp}`, pubBatchId]
    );
    await queryWithRetry(
      pool,
      `INSERT INTO certificates (
        id, "participantId", "batchId", status, "isStale", "publishedName", "publishedFilePath", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'PENDING', true, 'Old Published Name', 'certificates/old.pdf', NOW(), NOW())`,
      [`c4-search-${timestamp}`, p4.rows[0].id, pubBatchId]
    );

    // Participant 5: Unpublished batch certificate
    const p5 = await queryWithRetry(
      pool,
      `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Secret Unpublished Participant', NOW(), NOW()) RETURNING id`,
      [`p5-search-${timestamp}`, unpubBatchId]
    );
    await queryWithRetry(
      pool,
      `INSERT INTO certificates (
        id, "participantId", "batchId", status, "publishedName", "publishedFilePath", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'GENERATED', 'Secret Unpublished Participant', 'certificates/p5.pdf', NOW(), NOW())`,
      [`c5-search-${timestamp}`, p5.rows[0].id, unpubBatchId]
    );

    // Participant 6: Soft-deleted participant
    const p6 = await queryWithRetry(
      pool,
      `INSERT INTO participants (id, "batchId", name, "deletedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Soft Deleted Person', NOW(), NOW(), NOW()) RETURNING id`,
      [`p6-search-${timestamp}`, pubBatchId]
    );
    await queryWithRetry(
      pool,
      `INSERT INTO certificates (
        id, "participantId", "batchId", status, "publishedName", "publishedFilePath", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'GENERATED', 'Soft Deleted Person', 'certificates/p6.pdf', NOW(), NOW())`,
      [`c6-search-${timestamp}`, p6.rows[0].id, pubBatchId]
    );
  });

  test.afterAll(async () => {
    const batchIds = [pubBatchId, unpubBatchId].filter(Boolean);
    if (batchIds.length > 0) {
      await queryWithRetry(pool, `DELETE FROM certificates WHERE "batchId" = ANY($1)`, [batchIds]).catch(() => {});
      await queryWithRetry(pool, `DELETE FROM participants WHERE "batchId" = ANY($1)`, [batchIds]).catch(() => {});
      await queryWithRetry(pool, `DELETE FROM certificate_batches WHERE id = ANY($1)`, [batchIds]).catch(() => {});
    }
    if (templateId) {
      await queryWithRetry(pool, `DELETE FROM certificate_templates WHERE id = $1`, [templateId]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  test("public user can search certificates without login and view results", async ({ page }) => {
    // 1. Visit root route directly WITHOUT login
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.locator('[data-testid="public-search-title"]')).toHaveText("Search Your Certificate");
    await expect(page.locator('[data-testid="search-initial-state"]')).toBeVisible();

    const searchInput = page.locator('[data-testid="public-search-input"]');
    const searchSubmit = page.locator('[data-testid="public-search-submit"]');
    await expect(searchInput).toBeVisible();
    await expect(searchSubmit).toBeVisible();

    // 2. Partial lowercase search: "naufal"
    await searchInput.fill("naufal");
    await searchSubmit.click();

    await expect(page).toHaveURL(/\/\?q=naufal/);
    await expect(page.locator('[data-testid="search-results-summary"]')).toContainText("Found 1 certificate for “naufal”");
    await expect(page.locator(`[data-testid="search-result-item-c1-search-${timestamp}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="published-name"]')).toHaveText("Naufal Nabil Ramadhan");

    // 3. Case-insensitive search: "NAUFAL"
    await searchInput.fill("NAUFAL");
    await searchSubmit.click();

    await expect(page).toHaveURL(/\/\?q=NAUFAL/);
    await expect(page.locator(`[data-testid="search-result-item-c1-search-${timestamp}"]`)).toBeVisible();

    // 4. Duplicate names: "Budi Santoso" returns both matching certificates
    await searchInput.fill("Budi Santoso");
    await searchSubmit.click();

    await expect(page).toHaveURL(/\/\?q=Budi\+Santoso|\/\?q=Budi%20Santoso/);
    const budiResults = page.locator('[data-testid^="search-result-item-"]');
    await expect(budiResults).toHaveCount(2);
    await expect(page.locator(`[data-testid="search-result-item-c2-search-${timestamp}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="search-result-item-c3-search-${timestamp}"]`)).toBeVisible();

    // 5. Excluded records assertions:
    // a. Unpublished batch record does not appear
    await searchInput.fill("Secret Unpublished");
    await searchSubmit.click();
    await expect(page.locator('[data-testid="no-results-message"]')).toBeVisible();

    // b. Soft-deleted record does not appear
    await searchInput.fill("Soft Deleted Person");
    await searchSubmit.click();
    await expect(page.locator('[data-testid="no-results-message"]')).toBeVisible();

    // c. Replacement in progress:
    // Searching NEW uncommitted participant name does NOT match
    await searchInput.fill("Edited New Name");
    await searchSubmit.click();
    await expect(page.locator('[data-testid="no-results-message"]')).toBeVisible();

    // Searching OLD published name DOES match
    await searchInput.fill("Old Published Name");
    await searchSubmit.click();
    await expect(page.locator(`[data-testid="search-result-item-c4-search-${timestamp}"]`)).toBeVisible();

    // 6. Clear search returns to initial state
    const clearBtn = page.locator('[data-testid="clear-search-button"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(page).toHaveURL("/");
    await expect(page.locator('[data-testid="search-initial-state"]')).toBeVisible();
  });

  test("responsive layout: no horizontal overflow on mobile and desktop viewports", async ({ page }) => {
    // Mobile Viewport (iPhone SE: 375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?q=naufal");

    const hasMobileOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasMobileOverflow).toBe(false);

    // Desktop Viewport (1280x720)
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?q=naufal");

    const hasDesktopOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasDesktopOverflow).toBe(false);
  });
});
