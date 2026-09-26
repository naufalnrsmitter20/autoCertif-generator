import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

function getTestPgPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10000,
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

test.describe("Phase 5 - Name Position Editor Flow", () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  const hasStorageCreds =
    !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    !!(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

  test("full flow: PDF canvas editor, pointer drag, width slider, keyboard, persistence, and stale protection", async ({
    page,
  }) => {
    test.setTimeout(120000);
    test.skip(
      !hasStorageCreds,
      "Supabase Storage credentials are not configured in .env."
    );
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD are not configured"
    );

    const pool = getTestPgPool();
    const supabase = getTestSupabaseClient();
    const uploadedStoragePaths: string[] = [];
    const createdBatchIds: string[] = [];
    const batchName = `Position Editor PDF ${Date.now()}`;

    try {
      // 1. Login as ADMIN
      await page.goto("/login");
      await page.fill('input[type="email"]', adminEmail!);
      await page.fill('input[type="password"]', adminPassword!);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/admin/, { timeout: 30000 });

      // 2. Create DRAFT batch
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
      createdBatchIds.push(batchId);

      // 3. Create and upload a valid PDF template
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([800, 600]);
      const validPdfBytes = await pdfDoc.save();

      const fileInput = page.locator('[data-testid="template-file-input"]');
      await fileInput.setInputFiles({
        name: "test-cert.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(validPdfBytes),
      });

      await page.click('[data-testid="submit-template-upload-button"]');

      // Wait for template to configure with transient network retry
      const templateName = page.locator('[data-testid="template-display-name"]');
      try {
        await expect(templateName).toContainText("test-cert", { timeout: 30000 });
      } catch {
        const errorBanner = page.locator('[data-testid="template-error-banner"]');
        if (await errorBanner.isVisible()) {
          console.log("Retrying upload due to temporary network error...");
          await page.click('[data-testid="submit-template-upload-button"]');
          await expect(templateName).toContainText("test-cert", { timeout: 30000 });
        } else {
          throw new Error("Template name not visible and no error banner found.");
        }
      }

      const configureBtn = page.locator('[data-testid="configure-position-button"]');
      await expect(configureBtn).toBeVisible({ timeout: 15000 });
      await expect(configureBtn).toContainText("Configure Name Position");

      // Verify initial placement status
      const positionStatus = page.locator('[data-testid="template-position-status"]');
      await expect(positionStatus).toContainText("Not configured");

      // Record storage path for cleanup
      const batchRow = await pool.query(
        'SELECT "templateId" FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      const templateId = batchRow.rows[0].templateId;
      const tmplRow = await pool.query(
        'SELECT "sourceFilePath" FROM certificate_templates WHERE id = $1',
        [templateId]
      );
      if (tmplRow.rows[0]?.sourceFilePath) {
        uploadedStoragePaths.push(tmplRow.rows[0].sourceFilePath);
      }

      // 4. Navigate to Position Editor
      await configureBtn.click();
      await expect(page).toHaveURL(new RegExp(`/admin/batches/${batchId}/position`), {
        timeout: 30000,
      });

      // 5. Verify Editor components render cleanly
      const editor = page.locator('[data-testid="name-position-editor"]');
      await expect(editor).toBeVisible({ timeout: 10000 });

      const surface = page.locator('[data-testid="certificate-preview-surface"]');
      await expect(surface).toBeVisible({ timeout: 10000 });

      // Verify PDF canvas renders
      const canvas = page.locator('[data-testid="template-canvas-pdf"]');
      await expect(canvas).toBeVisible({ timeout: 15000 });

      // Verify participant name overlay exists with sample name
      const overlay = page.locator('[data-testid="participant-name-overlay"]');
      await expect(overlay).toBeVisible({ timeout: 10000 });
      await expect(overlay).toContainText("Nama Lengkap Peserta");

      // Verify default width is 70%
      const widthDisplay = page.locator('[data-testid="width-percentage-display"]');
      await expect(widthDisplay).toHaveText("70%");

      // 6. Test pointer dragging
      const surfaceBox = await surface.boundingBox();
      const initialOverlayBox = await overlay.boundingBox();
      expect(surfaceBox).toBeTruthy();
      expect(initialOverlayBox).toBeTruthy();

      // Drag overlay slightly to the right and down
      await page.mouse.move(
        initialOverlayBox!.x + initialOverlayBox!.width / 2,
        initialOverlayBox!.y + initialOverlayBox!.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(
        initialOverlayBox!.x + initialOverlayBox!.width / 2 + 40,
        initialOverlayBox!.y + initialOverlayBox!.height / 2 + 30,
        { steps: 5 }
      );
      await page.mouse.up();

      // Verify dirty state
      const unsavedIndicator = page.locator('[data-testid="unsaved-changes-indicator"]');
      await expect(unsavedIndicator).toBeVisible();

      // 7. Test width slider adjustment
      const widthSlider = page.locator('[data-testid="name-width-slider"]');
      await widthSlider.fill("60");
      await expect(widthDisplay).toHaveText("60%");

      // 8. Save placement
      const saveBtn = page.locator('[data-testid="save-position-button"]');
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // Verify save success indicator
      const saveSuccess = page.locator('[data-testid="save-success-indicator"]');
      await expect(saveSuccess).toBeVisible({ timeout: 30000 });
      await expect(saveSuccess).toHaveText("Saved");

      // Verify in DB that namePlacement is saved and valid
      const updatedTmpl = await pool.query(
        'SELECT "namePlacement" FROM certificate_templates WHERE id = $1',
        [templateId]
      );
      const savedPlacement = updatedTmpl.rows[0].namePlacement;
      expect(savedPlacement).toBeTruthy();
      expect(savedPlacement.maxWidthRatio).toBeCloseTo(0.6, 2);
      expect(savedPlacement.alignment).toBe("center");
      expect(savedPlacement.xRatio).toBeGreaterThan(0.3);
      expect(savedPlacement.yRatio).toBeGreaterThan(0.4);

      // Verify batch status remains DRAFT
      const batchCheck = await pool.query(
        'SELECT status FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      expect(batchCheck.rows[0].status).toBe("DRAFT");

      // 9. Reload page and verify persisted values restored
      await page.reload();
      await expect(page.locator('[data-testid="name-position-editor"]')).toBeVisible({ timeout: 10000 });
      await expect(widthDisplay).toHaveText("60%");

      // 10. Test keyboard positioning
      await overlay.focus();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowUp");
      await expect(unsavedIndicator).toBeVisible();

      await saveBtn.click();
      await expect(saveSuccess).toBeVisible({ timeout: 30000 });

      // 11. Test responsive layout on mobile viewport (390px)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);

      // Verify no horizontal page overflow
      const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const bodyClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(bodyScrollWidth).toBeLessThanOrEqual(bodyClientWidth + 1);

      // Reset viewport to desktop
      await page.setViewportSize({ width: 1280, height: 720 });

      // 12. Test atomic stale-template protection
      // Replace template in DB to simulate another admin replacing the template
      const replacedTmplRes = await pool.query(
        `INSERT INTO certificate_templates (id, name, "fileType", "pageWidth", "pageHeight", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), 'Replaced Template', 'PDF', 800, 600, NOW(), NOW())
         RETURNING id`
      );
      const replacedTemplateId = replacedTmplRes.rows[0].id;

      await pool.query(
        'UPDATE certificate_batches SET "templateId" = $1 WHERE id = $2',
        [replacedTemplateId, batchId]
      );

      // Now attempt to save in the stale editor (which holds the old template ID)
      await overlay.focus();
      await page.keyboard.press("ArrowRight");
      await expect(unsavedIndicator).toBeVisible();

      await saveBtn.click();

      // Verify 409 conflict banner surfaces
      const errorBanner = page.locator('[data-testid="position-editor-error-banner"]');
      await expect(errorBanner).toBeVisible({ timeout: 10000 });
      await expect(errorBanner).toContainText("Template Conflict");
      const reloadBtn = page.locator('[data-testid="reload-editor-button"]');
      await expect(reloadBtn).toBeVisible();

      // Clean up replaced template record
      await pool.query('DELETE FROM certificate_templates WHERE id = $1', [replacedTemplateId]);
    } finally {
      // Precise cleanup of test-owned records
      for (const id of createdBatchIds) {
        await pool.query("DELETE FROM certificate_batches WHERE id = $1", [id]);
      }
      for (const storagePath of uploadedStoragePaths) {
        try {
          await supabase.storage.from("certificate-templates").remove([storagePath]);
        } catch {
          // ignore cleanup errors
        }
      }
      await pool.end();
    }
  });

  test("smoke test: PNG image template positioning and preview", async ({ page }) => {
    test.setTimeout(120000);
    test.skip(
      !hasStorageCreds,
      "Supabase Storage credentials are not configured in .env."
    );
    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD are not configured"
    );

    const pool = getTestPgPool();
    const supabase = getTestSupabaseClient();
    const uploadedStoragePaths: string[] = [];
    const createdBatchIds: string[] = [];
    const batchName = `Position Editor PNG ${Date.now()}`;

    try {
      // 1. Login
      await page.goto("/login");
      await page.fill('input[type="email"]', adminEmail!);
      await page.fill('input[type="password"]', adminPassword!);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/admin/, { timeout: 30000 });

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
      createdBatchIds.push(batchId);

      // 3. Create valid PNG image
      const pngBuffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 240, g: 240, b: 240 },
        },
      })
        .png()
        .toBuffer();

      const fileInput = page.locator('[data-testid="template-file-input"]');
      await fileInput.setInputFiles({
        name: "cert-image.png",
        mimeType: "image/png",
        buffer: pngBuffer,
      });

      await page.click('[data-testid="submit-template-upload-button"]');

      const templateName = page.locator('[data-testid="template-display-name"]');
      try {
        await expect(templateName).toContainText("cert-image", { timeout: 30000 });
      } catch {
        const errorBanner = page.locator('[data-testid="template-error-banner"]');
        if (await errorBanner.isVisible()) {
          console.log("Retrying upload due to temporary network error...");
          await page.click('[data-testid="submit-template-upload-button"]');
          await expect(templateName).toContainText("cert-image", { timeout: 30000 });
        } else {
          throw new Error("Template name not visible and no error banner found.");
        }
      }

      const configureBtn = page.locator('[data-testid="configure-position-button"]');
      await expect(configureBtn).toBeVisible({ timeout: 15000 });

      // Record storage path
      const batchRow = await pool.query(
        'SELECT "templateId" FROM certificate_batches WHERE id = $1',
        [batchId]
      );
      const templateId = batchRow.rows[0].templateId;
      const tmplRow = await pool.query(
        'SELECT "sourceFilePath" FROM certificate_templates WHERE id = $1',
        [templateId]
      );
      if (tmplRow.rows[0]?.sourceFilePath) {
        uploadedStoragePaths.push(tmplRow.rows[0].sourceFilePath);
      }

      // 4. Open editor
      await configureBtn.click();
      await expect(page).toHaveURL(new RegExp(`/admin/batches/${batchId}/position`), {
        timeout: 30000,
      });

      // 5. Verify Image preview surface renders
      const imgSurface = page.locator('[data-testid="template-preview-image-surface"]');
      await expect(imgSurface).toBeVisible({ timeout: 15000 });

      // Verify overlay exists
      const overlay = page.locator('[data-testid="participant-name-overlay"]');
      await expect(overlay).toBeVisible();

      // 6. Adjust width and save
      const widthSlider = page.locator('[data-testid="name-width-slider"]');
      await widthSlider.fill("75");

      const saveBtn = page.locator('[data-testid="save-position-button"]');
      await saveBtn.click();

      const saveSuccess = page.locator('[data-testid="save-success-indicator"]');
      await expect(saveSuccess).toBeVisible({ timeout: 10000 });
      await expect(saveSuccess).toHaveText("Saved");

      // 7. Navigate back to batch
      await page.click('text=← Back to Batch');
      await expect(page).toHaveURL(new RegExp(`/admin/batches/${batchId}`), {
        timeout: 30000,
      });

      // Verify position status is now "Configured"
      const positionStatus = page.locator('[data-testid="template-position-status"]');
      await expect(positionStatus).toContainText("Configured");
      await expect(page.locator('[data-testid="configure-position-button"]')).toContainText("Edit Name Position");
    } finally {
      for (const id of createdBatchIds) {
        await pool.query("DELETE FROM certificate_batches WHERE id = $1", [id]);
      }
      for (const storagePath of uploadedStoragePaths) {
        try {
          await supabase.storage.from("certificate-templates").remove([storagePath]);
        } catch {
          // ignore
        }
      }
      await pool.end();
    }
  });
});
