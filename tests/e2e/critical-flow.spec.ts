import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { Pool, QueryResult, QueryResultRow } from "pg";
import { createClient } from "@supabase/supabase-js";

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

/**
 * Phase 14: Fixture-Assisted Cross-Phase Critical Flow
 *
 * Exercises the browser journey around a fixture-provided generation boundary.
 * Actual generation transport is covered separately.
 * 1. Unauthenticated public search visit
 * 2. ADMIN login & session verification
 * 3. Batch creation (DRAFT)
 * 4. Template upload (single-page PDF) & metadata verification
 * 5. Position Editor (spatial placement configuration & persistence)
 * 6. CSV participant import (memory parsing & atomic persistence)
 * 7. [Controlled Fixture Boundary Bridge] Seeds unpublished GENERATED certificates in storage/DB
 * 8. Real Phase 11 Publish UI: preflight verification, publication confirmation, snapshot establishment
 * 9. Unauthenticated Public Search: partial/case-insensitive query matching
 * 10. Public Certificate Detail: signed iframe PDF preview verification
 * 11. Public Download: 302 redirect with sanitized filename
 * 12. ADMIN Unpublish: real unpublish confirmation
 * 13. Revocation: 404 detail, 404 download, and search removal
 * 14. Complete dependency-safe cleanup
 */
test.describe("Critical Cross-Phase E2E Flow", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  const hasStorageCreds =
    !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    !!(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

  test("fixture-assisted journey from creation through publication, public access, and unpublish", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(360000);
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD are not configured"
    );
    test.skip(
      !hasStorageCreds,
      "Supabase Storage credentials are not configured"
    );

    const timestamp = Date.now();
    const batchName = `E2E Critical Batch ${timestamp}`;
    const participant1Name = `Rahmat Hidayat ${timestamp}`;
    const participant2Name = `Nurul Aini ${timestamp}`;

    const pool = getTestPgPool();
    const supabase = getTestSupabaseClient();

    const createdBatchIds: string[] = [];
    const createdTemplateIds: string[] = [];
    const uploadedTemplatePaths: string[] = [];
    const uploadedCertificatePaths: string[] = [];

    let batchId: string;
    let cert1Id: string;
    let publicContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let primaryError: unknown;

    try {
      // ────────────────────────────────────────────────────────────────────────
      // Step 1: Public initial visit (unauthenticated)
      // ────────────────────────────────────────────────────────────────────────
      await page.goto("/");
      await expect(page).toHaveURL("/");
      await expect(page.locator('[data-testid="public-search-title"]')).toHaveText("Search Your Certificate");
      await expect(page.locator('[data-testid="search-initial-state"]')).toBeVisible();

      // ────────────────────────────────────────────────────────────────────────
      // Step 2: ADMIN Login
      // ────────────────────────────────────────────────────────────────────────
      await page.goto("/login");
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeVisible({ timeout: 15000 });
      await emailInput.fill(adminEmail!);
      await page.fill('input[type="password"]', adminPassword!);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/admin(\/batches)?/, { timeout: 60000 });

      // ────────────────────────────────────────────────────────────────────────
      // Step 3: Create Batch
      // ────────────────────────────────────────────────────────────────────────
      await page.goto("/admin/batches/new");
      await page.fill("#batch-name", batchName);
      await page.click('[data-testid="submit-create-batch"]');
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/admin/batches/") &&
          url.pathname !== "/admin/batches/new",
        { timeout: 30000 }
      );
      const batchDetailUrl = page.url();
      batchId = batchDetailUrl.split("/admin/batches/")[1].split("/")[0];
      createdBatchIds.push(batchId);

      await expect(page.locator('[data-testid="batch-detail-title"]')).toContainText(batchName);
      await expect(page.locator('[data-testid="batch-status-badge"]')).toHaveText("Draft");

      // ────────────────────────────────────────────────────────────────────────
      // Step 4: Upload PDF Template
      // ────────────────────────────────────────────────────────────────────────
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([842, 595]);
      const validPdfBytes = await pdfDoc.save();

      const fileInput = page.locator('[data-testid="template-file-input"]');
      await fileInput.setInputFiles({
        name: "critical-template.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(validPdfBytes),
      });

      await page.click('[data-testid="submit-template-upload-button"]');

      const templateName = page.locator('[data-testid="template-display-name"]');
      await expect(templateName).toContainText("critical-template", { timeout: 60000 });

      // Record template DB ID and storage path
      const batchRow = await queryWithRetry(
        pool,
        'SELECT "templateId" FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      const templateId = batchRow.rows[0]?.templateId;
      expect(templateId).toBeTruthy();
      createdTemplateIds.push(templateId);

      const tmplRow = await queryWithRetry(
        pool,
        'SELECT "sourceFilePath" FROM certificate_templates WHERE id = $1',
        [templateId]
      );
      if (tmplRow.rows[0]?.sourceFilePath) {
        uploadedTemplatePaths.push(tmplRow.rows[0].sourceFilePath);
      }

      // ────────────────────────────────────────────────────────────────────────
      // Step 5: Position Editor
      // ────────────────────────────────────────────────────────────────────────
      const configureBtn = page.locator('[data-testid="configure-position-button"]');
      await expect(configureBtn).toBeVisible({ timeout: 15000 });
      await configureBtn.click();
      await expect(page).toHaveURL(new RegExp(`/admin/batches/${batchId}/position`), {
        timeout: 30000,
      });

      const widthSlider = page.locator('[data-testid="name-width-slider"]');
      await expect(widthSlider).toBeVisible({ timeout: 15000 });
      await widthSlider.fill("60");

      const saveBtn = page.locator('[data-testid="save-position-button"]');
      await saveBtn.click();

      const saveSuccess = page.locator('[data-testid="save-success-indicator"]');
      await expect(saveSuccess).toBeVisible({ timeout: 30000 });

      await page.click('text=← Back to Batch');
      await expect(page).toHaveURL(new RegExp(`/admin/batches/${batchId}$`), {
        timeout: 30000,
      });
      await expect(page.locator('[data-testid="template-position-status"]')).toHaveText("Configured");

      // ────────────────────────────────────────────────────────────────────────
      // Step 6: Import Participants via CSV
      // ────────────────────────────────────────────────────────────────────────
      const manageParticipantsLink = page.locator('[data-testid="manage-participants-link"]');
      await manageParticipantsLink.click();
      await expect(page).toHaveURL(new RegExp(`/admin/batches/${batchId}/participants`), {
        timeout: 30000,
      });

      const csvContent = `name\n${participant1Name}\n${participant2Name}\n`;
      const csvInput = page.locator('[data-testid="csv-file-input"]');
      await expect(csvInput).toBeVisible({ timeout: 15000 });
      await csvInput.setInputFiles({
        name: "participants.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvContent, "utf-8"),
      });

      await expect(page.locator('[data-testid="csv-preview-container"]')).toBeVisible({ timeout: 10000 });
      const confirmImportBtn = page.locator('[data-testid="confirm-import-button"]');
      await confirmImportBtn.click();

      await expect(page.locator('[data-testid="import-success"]')).toBeVisible({ timeout: 15000 });
      const participantRows = page.locator('[data-testid^="participant-name-"]');
      await expect(participantRows).toHaveCount(2, { timeout: 15000 });

      // ────────────────────────────────────────────────────────────────────────
      // Step 7: [Fixture-Assisted Generation Boundary Bridge]
      // Establish unpublished GENERATED certificate state.
      // Notice: publishedName and publishedFilePath remain NULL here.
      // ────────────────────────────────────────────────────────────────────────
      const pRows = await queryWithRetry<{ id: string; name: string }>(
        pool,
        'SELECT id, name FROM participants WHERE "batchId" = $1 ORDER BY "createdAt" ASC',
        [batchId]
      );
      expect(pRows.rows).toHaveLength(2);
      const part1Id = pRows.rows[0].id;
      const part2Id = pRows.rows[1].id;

      const cert1StoragePath = `certificates/${batchId}/${part1Id}/${timestamp}.pdf`;
      const cert2StoragePath = `certificates/${batchId}/${part2Id}/${timestamp}.pdf`;
      uploadedCertificatePaths.push(cert1StoragePath, cert2StoragePath);

      // Upload valid PDF certificate files to private generated-certificates bucket
      const cert1Doc = await PDFDocument.create();
      cert1Doc.addPage([842, 595]);
      const cert1Bytes = await cert1Doc.save();

      const uploadFixture = async (storagePath: string, bytes: Uint8Array) => {
        const { error } = await supabase.storage
          .from("generated-certificates")
          .upload(storagePath, bytes, {
            contentType: "application/pdf",
            upsert: false,
          });
        if (error) throw error;
      };

      await uploadFixture(cert1StoragePath, cert1Bytes);
      await uploadFixture(cert2StoragePath, cert1Bytes);

      const genKey = `crit-key-${timestamp}`;
      cert1Id = `cert-crit-1-${timestamp}`;
      const cert2Id = `cert-crit-2-${timestamp}`;

      // Insert unpublished GENERATED certificates (publishedName and publishedFilePath are NULL)
      await queryWithRetry(
        pool,
        `INSERT INTO certificates (
          id, "participantId", "batchId", status, "generationKey", "generatedFilePath", "generatedAt", "isStale", "createdAt", "updatedAt"
        ) VALUES
          ($1, $2, $3, 'GENERATED', $4, $5, NOW(), false, NOW(), NOW()),
          ($6, $7, $3, 'GENERATED', $4, $8, NOW(), false, NOW(), NOW())`,
        [cert1Id, part1Id, batchId, genKey, cert1StoragePath, cert2Id, part2Id, cert2StoragePath]
      );

      // Transition batch to GENERATED
      await queryWithRetry(
        pool,
        'UPDATE certificate_batches SET status = $1, "currentGenerationKey" = $2 WHERE id = $3',
        ['GENERATED', genKey, batchId]
      );

      // ────────────────────────────────────────────────────────────────────────
      // Step 8: Real Phase 11 Publish UI
      // ────────────────────────────────────────────────────────────────────────
      await page.goto(`/admin/batches/${batchId}`);
      await expect(page.locator('[data-testid="batch-status-badge"]')).toHaveText("Generated", { timeout: 30000 });

      const openPublishBtn = page.locator('[data-testid="open-publish-dialog-button"]');
      await expect(openPublishBtn).toBeVisible({ timeout: 15000 });
      await openPublishBtn.click();

      const publishDialog = page.locator('div[role="dialog"]');
      await expect(publishDialog).toBeVisible({ timeout: 15000 });

      const eligibleCount = page.locator('[data-testid="publish-eligible-count"]');
      await expect(eligibleCount).toBeVisible({ timeout: 60000 });
      await expect(eligibleCount).toHaveText("2 of 2");

      const confirmPublishBtn = page.locator('[data-testid="confirm-publish-button"]');
      await expect(confirmPublishBtn).toBeEnabled({ timeout: 15000 });
      await confirmPublishBtn.click();

      // Dialog closes and batch status reflects PUBLISHED
      await expect(publishDialog).not.toBeVisible({ timeout: 60000 });
      await expect(page.locator('[data-testid="batch-status-badge"]')).toHaveText("Published", { timeout: 60000 });

      // Authoritative database check: verify Publish established publishedName and publishedFilePath
      const publishedCertCheck = await queryWithRetry<{ publishedName: string; publishedFilePath: string }>(
        pool,
        'SELECT "publishedName", "publishedFilePath" FROM certificates WHERE id = $1',
        [cert1Id]
      );
      expect(publishedCertCheck.rows[0]?.publishedName).toBe(participant1Name);
      expect(publishedCertCheck.rows[0]?.publishedFilePath).toBe(cert1StoragePath);

      // ────────────────────────────────────────────────────────────────────────
      // Step 9: Unauthenticated Public Search
      // ────────────────────────────────────────────────────────────────────────
      publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();

      await publicPage.goto("/");
      const searchInput = publicPage.locator('[data-testid="public-search-input"]');
      const searchSubmit = publicPage.locator('[data-testid="public-search-submit"]');

      // Search for participant 1 name
      await searchInput.fill(participant1Name);
      await searchSubmit.click();

      const resultItem = publicPage.locator(`[data-testid="search-result-item-${cert1Id}"]`);
      await expect(resultItem).toBeVisible({ timeout: 30000 });
      await expect(publicPage.locator('[data-testid="published-name"]')).toHaveText(participant1Name);

      // ────────────────────────────────────────────────────────────────────────
      // Step 10: Public Certificate Detail & PDF Preview
      // ────────────────────────────────────────────────────────────────────────
      const viewLink = publicPage.locator(`[data-testid="view-certificate-link-${cert1Id}"]`);
      await viewLink.click();
      await publicPage.waitForURL(new RegExp(`/certificates/${cert1Id}`), { timeout: 30000 });

      await expect(publicPage.locator('[data-testid="certificate-participant-name"]')).toHaveText(participant1Name);

      const previewIframe = publicPage.locator('[data-testid="certificate-preview-iframe"]');
      await expect(previewIframe).toBeVisible({ timeout: 15000 });
      await expect(previewIframe).toHaveAttribute("referrerpolicy", "no-referrer");

      const iframeSrc = await previewIframe.getAttribute("src");
      expect(iframeSrc).toBeTruthy();
      expect(iframeSrc).toContain("token=");

      // Fetch signed preview URL directly to verify 200 and application/pdf headers
      const iframeResp = await request.get(iframeSrc!);
      expect(iframeResp.status()).toBe(200);
      expect(iframeResp.headers()["content-type"]).toContain("application/pdf");

      // ────────────────────────────────────────────────────────────────────────
      // Step 11: Public Download
      // ────────────────────────────────────────────────────────────────────────
      const downloadBtn = publicPage.locator('[data-testid="certificate-download-button"]');
      await expect(downloadBtn).toBeVisible();
      await expect(downloadBtn).toHaveAttribute("href", `/certificates/${cert1Id}/download`);

      const downloadResp = await request.get(`/certificates/${cert1Id}/download`, {
        maxRedirects: 0,
      });
      expect(downloadResp.status()).toBe(302);
      expect(downloadResp.headers()["cache-control"]).toBe("no-store");
      expect(downloadResp.headers()["location"]).toContain("download=certificate-rahmat-hidayat");

      // ────────────────────────────────────────────────────────────────────────
      // Step 12: ADMIN Unpublish
      // ────────────────────────────────────────────────────────────────────────
      await page.goto(`/admin/batches/${batchId}`);
      const openUnpublishBtn = page.locator('[data-testid="open-unpublish-dialog-button"]');
      await expect(openUnpublishBtn).toBeVisible({ timeout: 15000 });
      await openUnpublishBtn.click();

      const unpublishDialog = page.locator('div[role="dialog"]');
      await expect(unpublishDialog).toBeVisible({ timeout: 15000 });

      const confirmUnpublishBtn = page.locator('[data-testid="confirm-unpublish-button"]');
      await confirmUnpublishBtn.click();

      await expect(unpublishDialog).not.toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-testid="batch-status-badge"]')).toHaveText("Generated", { timeout: 30000 });

      // ────────────────────────────────────────────────────────────────────────
      // Step 13: Revocation Verification
      // ────────────────────────────────────────────────────────────────────────
      // a. Direct detail route reloads to 404
      await publicPage.reload();
      await expect(publicPage.locator('[data-testid="certificate-not-found"]')).toBeVisible({ timeout: 15000 });

      // b. Direct download route returns 404
      const unpubDownloadResp = await request.get(`/certificates/${cert1Id}/download`, {
        maxRedirects: 0,
      });
      expect(unpubDownloadResp.status()).toBe(404);
      expect(unpubDownloadResp.headers()["cache-control"]).toBe("no-store");

      // c. Public search returns no results
      await publicPage.goto(`/?q=${encodeURIComponent(participant1Name)}`);
      await expect(publicPage.locator('[data-testid="no-results-message"]')).toBeVisible({ timeout: 15000 });

      await publicContext.close();
      publicContext = undefined;
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      // ────────────────────────────────────────────────────────────────────────
      // Step 14: Dependency-Safe Complete Teardown
      // ────────────────────────────────────────────────────────────────────────
      const cleanupErrors: unknown[] = [];
      if (publicContext) {
        try { await publicContext.close(); } catch (error) { cleanupErrors.push(error); }
      }
      for (const id of createdBatchIds) {
        try {
          await queryWithRetry(pool, 'DELETE FROM certificates WHERE "batchId" = $1', [id]);
          await queryWithRetry(pool, 'DELETE FROM participants WHERE "batchId" = $1', [id]);
          await queryWithRetry(pool, 'DELETE FROM certificate_batches WHERE id = $1', [id]);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      for (const tmplId of createdTemplateIds) {
        try {
          await queryWithRetry(pool, 'DELETE FROM certificate_templates WHERE id = $1', [tmplId]);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      for (const storagePath of uploadedCertificatePaths) {
        try {
          const { error } = await supabase.storage.from("generated-certificates").remove([storagePath]);
          if (error) cleanupErrors.push(error);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      for (const storagePath of uploadedTemplatePaths) {
        try {
          const { error } = await supabase.storage.from("certificate-templates").remove([storagePath]);
          if (error) cleanupErrors.push(error);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      try { await pool.end(); } catch (error) { cleanupErrors.push(error); }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
          "Critical-flow cleanup failed"
        );
      }
    }
  });
});
