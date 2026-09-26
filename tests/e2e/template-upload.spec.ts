import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
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

test.describe("Certificate Template Upload Flow", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  const hasStorageCreds =
    !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    !!(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

  test("template section renders cleanly on batch detail page with client validation", async ({
    page,
  }) => {
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD environment credentials are not configured"
    );

    const batchName = `Template UI Test Batch ${Date.now()}`;

    // 1. Login as ADMIN
    await page.goto("/login");
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/admin(\/batches)?/, { timeout: 30000 });

    // 2. Create batch
    await page.goto("/admin/batches/new");
    await page.fill("#batch-name", batchName);
    await page.click('[data-testid="submit-create-batch"]');

    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/admin/batches/") &&
        url.pathname !== "/admin/batches/new",
      { timeout: 15000 }
    );
    const batchDetailUrl = page.url();

    // 3. Verify template section exists and is unconfigured
    const templateSection = page.locator('[data-testid="template-management-section"]');
    await expect(templateSection).toBeVisible({ timeout: 10000 });
    await expect(templateSection).toContainText("Certificate Template");
    await expect(templateSection).toContainText("Single-page background artwork");

    // 4. Verify file input element exists
    const fileInput = page.locator('[data-testid="template-file-input"]');
    await expect(fileInput).toBeAttached();

    // 5. Test client rejection of unsupported extension (.txt file)
    await fileInput.setInputFiles({
      name: "invalid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a valid certificate"),
    });

    const errorBanner = page.locator('[data-testid="template-error-banner"]');
    await expect(errorBanner).toBeVisible({ timeout: 5000 });
    await expect(errorBanner).toContainText(
      "Please select a valid single-page PDF, PNG, or JPG/JPEG file."
    );

    // 6. Cleanup test batch
    await page.goto(batchDetailUrl);
    await page.click('[data-testid="open-delete-dialog-button"]');
    await page.click('[data-testid="confirm-delete-batch-button"]');
    await page.waitForURL((url) => url.pathname === "/admin/batches", { timeout: 15000 });
  });

  test("live direct upload, server byte validation, signed preview, and replacement", async ({
    page,
  }) => {
    test.setTimeout(180000);
    test.skip(
      !hasStorageCreds,
      "Supabase Storage credentials are not configured in .env. Live storage upload is NOT VERIFIED in this environment."
    );
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD are not configured"
    );

    const batchName = `Live Template Upload ${Date.now()}`;
    const uploadedStoragePaths: string[] = [];
    const pool = getTestPgPool();
    const supabase = getTestSupabaseClient();

    try {
      // 1. Login
      await page.goto("/login");
      await page.fill('input[type="email"]', adminEmail!);
      await page.fill('input[type="password"]', adminPassword!);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/admin/, { timeout: 15000 });

      // 2. Create batch
      await page.goto("/admin/batches/new");
      await page.fill("#batch-name", batchName);
      await page.click('[data-testid="submit-create-batch"]');
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/admin/batches/") &&
          url.pathname !== "/admin/batches/new",
        { timeout: 15000 }
      );
      const batchDetailUrl = page.url();
      const batchId = batchDetailUrl.split("/").pop()!;

      // 3. Create valid single-page PDF in memory
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([800, 600]);
      const validPdfBytes = await pdfDoc.save();

      // 4. Select and upload initial PDF template
      const fileInput = page.locator('[data-testid="template-file-input"]');
      await fileInput.setInputFiles({
        name: "e2e-valid-cert.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(validPdfBytes),
      });

      await page.click('[data-testid="submit-template-upload-button"]');

      // 5. Verify template metadata appears
      const templateName = page.locator('[data-testid="template-display-name"]');
      try {
        await expect(templateName).toContainText("e2e-valid-cert", { timeout: 60000 });
      } catch {
        const errorBanner = page.locator('[data-testid="template-error-banner"]');
        if (await errorBanner.isVisible()) {
          console.log("Retrying upload due to temporary network error...");
          await page.click('[data-testid="submit-template-upload-button"]');
          await expect(templateName).toContainText("e2e-valid-cert", { timeout: 60000 });
        } else {
          throw new Error("Template name not visible and no error banner found.");
        }
      }

      const dimensions = page.locator('[data-testid="template-metadata-type-dimensions"]');
      await expect(dimensions).toContainText("PDF");
      await expect(dimensions).toContainText("800 × 600 pt");

      // Verify batch status remains DRAFT
      await expect(page.locator('[data-testid="batch-status-badge"]')).toContainText("Draft");

      // 6. Verify signed private preview loads successfully
      const previewPdf = page.locator('[data-testid="template-preview-pdf"]');
      await expect(previewPdf).toBeVisible({ timeout: 15000 });
      const previewDataAttr = await previewPdf.getAttribute("data");
      expect(previewDataAttr).toBeTruthy();
      expect(previewDataAttr).toContain("token=");

      // Verify signed preview URL returns HTTP 200 with PDF content
      const previewResponse = await page.request.get(previewDataAttr!);
      expect(previewResponse.status()).toBe(200);
      expect(previewResponse.headers()["content-type"]).toContain("application/pdf");

      // Capture initial template DB and storage details
      const batchRes = await queryWithRetry(
        pool,
        'SELECT "templateId" FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      expect(batchRes.rows[0]?.templateId).toBeTruthy();
      const initialTemplateId = batchRes.rows[0].templateId;

      const templateRes = await queryWithRetry(
        pool,
        'SELECT "sourceFilePath", "deletedAt" FROM certificate_templates WHERE id = $1',
        [initialTemplateId]
      );
      expect(templateRes.rows[0]?.sourceFilePath).toBeTruthy();
      const initialStoragePath = templateRes.rows[0].sourceFilePath;
      uploadedStoragePaths.push(initialStoragePath);

      // Verify unauthenticated / public request directly to storage is blocked
      const supabaseUrl =
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const unauthDirectUrl = `${supabaseUrl}/storage/v1/object/public/certificate-templates/${initialStoragePath}`;
      const unauthResp = await page.request.get(unauthDirectUrl);
      expect(unauthResp.status()).toBeGreaterThanOrEqual(400);

      // 7. Test invalid multi-page PDF rejection via replace flow
      await page.click('[data-testid="replace-template-button"]');
      const replaceInput = page.locator('[data-testid="replace-template-file-input"]');
      await expect(replaceInput).toBeVisible();

      const multiDoc = await PDFDocument.create();
      multiDoc.addPage([600, 400]);
      multiDoc.addPage([600, 400]);
      const multiPdfBytes = await multiDoc.save();

      // Intercept initiate request to capture candidate storage path
      const initiatePromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/admin/batches/${batchId}/template/initiate`) &&
          resp.status() === 200
      );

      await replaceInput.setInputFiles({
        name: "multi-page-fail.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(multiPdfBytes),
      });

      await page.click('[data-testid="confirm-replace-template-button"]');

      const initiateResp = await initiatePromise;
      const initiateData = await initiateResp.json();
      const multiCandidatePath = initiateData.storagePath;

      // Verify actionable rejection banner
      const errorBanner = page.locator('[data-testid="template-error-banner"]');
      await expect(errorBanner).toBeVisible({ timeout: 15000 });
      await expect(errorBanner).toContainText("Multi-page PDFs are not supported");

      // Verify existing template remains intact after failed replacement
      const batchCheckRes = await queryWithRetry(
        pool,
        'SELECT "templateId" FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      expect(batchCheckRes.rows[0]?.templateId).toBe(initialTemplateId);

      // Verify candidate multi-page file was deleted by server compensating cleanup
      if (multiCandidatePath) {
        const { data: cleanedUpFile, error: cleanupCheckError } = await supabase.storage
          .from("certificate-templates")
          .download(multiCandidatePath);
        expect(cleanedUpFile === null || cleanupCheckError !== null).toBe(true);
      }

      // 8. Test successful replacement with a valid PNG image
      const pngBuffer = await sharp({
        create: {
          width: 1024,
          height: 768,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      await replaceInput.setInputFiles({
        name: "e2e-replacement.png",
        mimeType: "image/png",
        buffer: pngBuffer,
      });

      await page.click('[data-testid="confirm-replace-template-button"]');

      // Verify replacement metadata appears
      await expect(page.locator('[data-testid="template-display-name"]')).toContainText(
        "e2e-replacement",
        { timeout: 20000 }
      );
      await expect(dimensions).toContainText("PNG");
      await expect(dimensions).toContainText("1024 × 768 px");

      // Verify image preview loads
      const previewImg = page.locator('[data-testid="template-preview-image"]');
      await expect(previewImg).toBeVisible({ timeout: 15000 });
      const imgSrc = await previewImg.getAttribute("src");
      expect(imgSrc).toBeTruthy();
      expect(imgSrc).toContain("token=");

      // Verify signed preview URL returns HTTP 200 with PNG content
      const previewImgResponse = await page.request.get(imgSrc!);
      expect(previewImgResponse.status()).toBe(200);
      expect(previewImgResponse.headers()["content-type"]).toContain("image/png");

      // 9. Verify database soft-deletion & storage retention behavior
      const prevTemplateRes = await queryWithRetry(
        pool,
        'SELECT "deletedAt" FROM certificate_templates WHERE id = $1',
        [initialTemplateId]
      );
      expect(prevTemplateRes.rows[0]?.deletedAt).not.toBeNull();

      const newBatchRes = await queryWithRetry(
        pool,
        'SELECT "templateId" FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      const replacementTemplateId = newBatchRes.rows[0]?.templateId;
      expect(replacementTemplateId).toBeTruthy();
      expect(replacementTemplateId).not.toBe(initialTemplateId);

      const replacementTemplateRes = await queryWithRetry(
        pool,
        'SELECT "sourceFilePath" FROM certificate_templates WHERE id = $1',
        [replacementTemplateId]
      );
      const replacementStoragePath = replacementTemplateRes.rows[0]?.sourceFilePath;
      uploadedStoragePaths.push(replacementStoragePath);

      // Verify previous storage object is still preserved (NOT physically deleted)
      const { data: prevFileData, error: downloadError } = await supabase.storage
        .from("certificate-templates")
        .download(initialStoragePath);
      expect(downloadError).toBeNull();
      expect(prevFileData).toBeTruthy();
      const prevArrayBuffer = await prevFileData!.arrayBuffer();
      expect(prevArrayBuffer.byteLength).toBeGreaterThan(0);

      // 10. Clean up test batch via UI
      await page.click('[data-testid="open-delete-dialog-button"]');
      await page.click('[data-testid="confirm-delete-batch-button"]');
      await page.waitForURL((url) => url.pathname === "/admin/batches", { timeout: 15000 });
    } finally {
      await pool.end();
      // 11. Test-owned resource cleanup: delete only exact test-owned storage objects
      for (const storagePath of uploadedStoragePaths) {
        try {
          await supabase.storage.from("certificate-templates").remove([storagePath]);
        } catch {
          // Ignore cleanup errors for already cleaned or missing objects
        }
      }
    }
  });
});
