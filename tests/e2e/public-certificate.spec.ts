import { test, expect } from "@playwright/test";
import { Pool, QueryResult, QueryResultRow } from "pg";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";

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

function getTestSupabaseClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseSecret) {
    throw new Error("Supabase credentials missing");
  }
  return createClient(supabaseUrl, supabaseSecret, {
    auth: { persistSession: false, autoRefreshToken: false },
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

test.describe("Public Certificate Detail & Download Flow (Phase 13)", () => {
  const timestamp = Date.now();
  const pool = getTestPgPool();
  const supabase = getTestSupabaseClient();

  const certStoragePath = `certificates/e2e-batch-${timestamp}/dewi/${timestamp}.pdf`;
  let templateId: string;
  let batchId: string;
  let participantId: string;
  let certificateId: string;

  test.beforeAll(async () => {
    // 1. Upload real single-page PDF to generated-certificates bucket
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([842, 595]);
    const pdfBytes = await pdfDoc.save();

    const { error: uploadErr } = await supabase.storage
      .from("generated-certificates")
      .upload(certStoragePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      throw new Error(`Failed to upload test certificate PDF: ${uploadErr.message}`);
    }

    // 2. Create Template
    const tRes = await queryWithRetry(
      pool,
      `INSERT INTO certificate_templates (
        id, name, "fileType", "sourceFilePath", "pageWidth", "pageHeight",
        "createdAt", "updatedAt"
      ) VALUES ($1, 'E2E Cert Template', 'PDF', 'templates/dummy.pdf', 842, 595, NOW(), NOW()) RETURNING id`,
      [`tpl-e2e-cert-${timestamp}`]
    );
    templateId = tRes.rows[0].id;

    // 3. Create Published Batch
    const bRes = await queryWithRetry(
      pool,
      `INSERT INTO certificate_batches (
        id, name, status, "templateId", "publishedAt", "createdAt", "updatedAt"
      ) VALUES ($1, 'E2E Cert Published Batch', 'PUBLISHED', $2, NOW(), NOW(), NOW()) RETURNING id`,
      [`batch-e2e-cert-${timestamp}`, templateId]
    );
    batchId = bRes.rows[0].id;

    // 4. Create Participant: "Dewi Sartika"
    const pRes = await queryWithRetry(
      pool,
      `INSERT INTO participants (id, "batchId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Dewi Sartika', NOW(), NOW()) RETURNING id`,
      [`p-dewi-${timestamp}`, batchId]
    );
    participantId = pRes.rows[0].id;

    // 5. Create Certificate with published snapshot
    const cRes = await queryWithRetry(
      pool,
      `INSERT INTO certificates (
        id, "participantId", "batchId", status, "publishedName", "publishedFilePath", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'GENERATED', 'Dewi Sartika', $4, NOW(), NOW()) RETURNING id`,
      [`c-dewi-${timestamp}`, participantId, batchId, certStoragePath]
    );
    certificateId = cRes.rows[0].id;
  });

  test.afterAll(async () => {
    // 1. Remove storage file
    await supabase.storage
      .from("generated-certificates")
      .remove([certStoragePath])
      .catch(() => {});

    // 2. Clean up DB records
    if (batchId) {
      await queryWithRetry(pool, `DELETE FROM certificates WHERE "batchId" = $1`, [batchId]).catch(() => {});
      await queryWithRetry(pool, `DELETE FROM participants WHERE "batchId" = $1`, [batchId]).catch(() => {});
      await queryWithRetry(pool, `DELETE FROM certificate_batches WHERE id = $1`, [batchId]).catch(() => {});
    }
    if (templateId) {
      await queryWithRetry(pool, `DELETE FROM certificate_templates WHERE id = $1`, [templateId]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  test("public visitor searches, views certificate detail with preview, downloads, and observes unpublish revocation", async ({
    page,
    request,
  }) => {
    // 1. Visit root search page without logging in
    await page.goto("/");
    await expect(page).toHaveURL("/");

    const searchInput = page.locator('[data-testid="public-search-input"]');
    const searchSubmit = page.locator('[data-testid="public-search-submit"]');

    // 2. Search for "dewi"
    await searchInput.fill("dewi");
    await searchSubmit.click();

    await expect(page).toHaveURL(/\/\?q=dewi/);
    const resultItem = page.locator(`[data-testid="search-result-item-${certificateId}"]`);
    await expect(resultItem).toBeVisible();

    const viewLink = page.locator(`[data-testid="view-certificate-link-${certificateId}"]`);
    await expect(viewLink).toBeVisible();

    // 3. Click "View Certificate" -> Navigates to certificate detail page
    await viewLink.click();
    await expect(page).toHaveURL(new RegExp(`/certificates/${certificateId}`), { timeout: 15000 });

    // 4. Verify participant name and UI elements
    await expect(page.locator('[data-testid="certificate-participant-name"]')).toHaveText("Dewi Sartika");

    const iframe = page.locator('[data-testid="certificate-preview-iframe"]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("title", "Certificate for Dewi Sartika");
    await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");

    const iframeSrc = await iframe.getAttribute("src");
    expect(iframeSrc).toBeTruthy();
    expect(iframeSrc).toContain("token=");

    // Fetch the iframe signed URL directly: verify it resolves to valid PDF
    const iframeRes = await request.get(iframeSrc!);
    expect(iframeRes.status()).toBe(200);
    expect(iframeRes.headers()["content-type"]).toContain("application/pdf");

    // Verify Action buttons
    const downloadBtn = page.locator('[data-testid="certificate-download-button"]');
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toHaveAttribute("href", `/certificates/${certificateId}/download`);

    const openLink = page.locator('[data-testid="certificate-open-pdf-link"]');
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute("target", "_blank");

    // 5. Test Download Route Handler via HTTP GET:
    // It should return 302 redirect with Location pointing to signed URL and Cache-Control: no-store
    const downloadRes = await request.get(`/certificates/${certificateId}/download`, {
      maxRedirects: 0,
    });
    expect(downloadRes.status()).toBe(302);
    expect(downloadRes.headers()["cache-control"]).toBe("no-store");

    const redirectLocation = downloadRes.headers()["location"];
    expect(redirectLocation).toBeTruthy();
    expect(redirectLocation).toContain("download=certificate-dewi-sartika.pdf");

    // 6. Test Unpublish: update batch in DB to clear publishedAt
    await queryWithRetry(pool, `UPDATE certificate_batches SET "publishedAt" = NULL WHERE id = $1`, [batchId]);

    // 7. Reload Detail Page: must now display Not Found (404)
    await page.reload();
    await expect(page.locator('[data-testid="certificate-not-found"]')).toBeVisible();

    // 8. Direct Download Route request: must now return HTTP 404 with Cache-Control: no-store
    const unpubDownloadRes = await request.get(`/certificates/${certificateId}/download`, {
      maxRedirects: 0,
    });
    expect(unpubDownloadRes.status()).toBe(404);
    expect(unpubDownloadRes.headers()["cache-control"]).toBe("no-store");
  });

  test("responsive viewport check: no horizontal overflow on mobile and desktop", async ({ page }) => {
    // Mobile Viewport (iPhone SE: 375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/certificates/${certificateId}`);

    const hasMobileOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasMobileOverflow).toBe(false);

    // Desktop Viewport (1280x720)
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/certificates/${certificateId}`);

    const hasDesktopOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasDesktopOverflow).toBe(false);
  });
});
