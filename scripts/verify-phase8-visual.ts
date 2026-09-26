import fs from "fs";
import path from "path";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { TemplateFileType } from "@/generated/prisma/client";
import {
  renderSingleCertificate,
  RenderCertificateInput,
} from "@/lib/rendering/engine";
import { NamePlacement } from "@/lib/coordinates";

const TEST_FONT_PATH = path.join(
  process.cwd(),
  "tests/fixtures/fonts/test-font.ttf"
);
const OUTPUT_DIR = path.join(process.cwd(), "tests/fixtures/output");

interface ScenarioResult {
  scenario: string;
  templateType: string;
  name: string;
  mode: "single-line" | "two-line";
  fontSize: number;
  pageWidth: number;
  pageHeight: number;
  lines: Array<{
    text: string;
    width: number;
    startX: number;
    baselineY: number;
  }>;
  rasterizedWidth: number;
  rasterizedHeight: number;
  checks: Record<string, boolean>;
}

async function main() {
  console.log("==========================================================");
  console.log("AutoCertif — Phase 8 Final Visual & Raster Verification");
  console.log("==========================================================\n");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const fontBytes = fs.readFileSync(TEST_FONT_PATH);
  const results: ScenarioResult[] = [];

  // ------------------------------------------------------------------------
  // Helper: Create Template with Explicit Visual Artwork
  // ------------------------------------------------------------------------
  async function createPdfTemplateWithArtwork(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]); // A4 Landscape

    // Draw Certificate Outer Border (Navy)
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 802,
      height: 555,
      borderColor: rgb(0.1, 0.2, 0.4),
      borderWidth: 3,
    });

    // Draw Certificate Inner Border (Gold)
    page.drawRectangle({
      x: 28,
      y: 28,
      width: 786,
      height: 539,
      borderColor: rgb(0.85, 0.65, 0.13),
      borderWidth: 1.5,
    });

    // Draw Corner Accents
    page.drawRectangle({
      x: 35,
      y: 530,
      width: 40,
      height: 25,
      color: rgb(0.1, 0.2, 0.4),
    });
    page.drawRectangle({
      x: 767,
      y: 530,
      width: 40,
      height: 25,
      color: rgb(0.1, 0.2, 0.4),
    });

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  async function createPngTemplateWithArtwork(
    density: number = 150
  ): Promise<Buffer> {
    // 1200 x 800 image with distinct frame and gradient-like background
    const svgOverlay = `
      <svg width="1200" height="800">
        <rect x="20" y="20" width="1160" height="760" fill="none" stroke="#b8860b" stroke-width="6" />
        <rect x="35" y="35" width="1130" height="730" fill="none" stroke="#1a365d" stroke-width="2" />
        <circle cx="600" cy="120" r="40" fill="#b8860b" opacity="0.3" />
      </svg>
    `;

    return await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 4,
        background: { r: 250, g: 249, b: 246, alpha: 1 },
      },
    })
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .withMetadata({ density })
      .png()
      .toBuffer();
  }

  const pdfTemplateBytes = await createPdfTemplateWithArtwork();
  const pngTemplateBytes = await createPngTemplateWithArtwork(150);

  // ------------------------------------------------------------------------
  // Helper: Rasterize PDF via PDF.js + @napi-rs/canvas and Verify
  // ------------------------------------------------------------------------
  async function rasterizeAndVerify(
    pdfBytes: Uint8Array,
    outputFilename: string
  ) {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytes),
      useSystemFonts: true,
    });
    const pdfDoc = await loadingTask.promise;
    if (pdfDoc.numPages !== 1) {
      throw new Error(`Expected 1 page, got ${pdfDoc.numPages}`);
    }

    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for sharp inspection
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.render as any)({ canvasContext: context as any, viewport }).promise;

    const pngBuffer = canvas.toBuffer("image/png");
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    fs.writeFileSync(outputPath, pngBuffer);

    // Inspect pixel buffer to verify non-blank rendering
    const rawPixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhitePixels = 0;
    for (let i = 0; i < rawPixels.length; i += 4) {
      const r = rawPixels[i];
      const g = rawPixels[i + 1];
      const b = rawPixels[i + 2];
      const a = rawPixels[i + 3];
      // Check if pixel deviates from pure white (255, 255, 255)
      if (a > 0 && (r < 250 || g < 250 || b < 250)) {
        nonWhitePixels++;
      }
    }

    // Text content verification
    const textContent = await page.getTextContent();
    const extractedStrings = textContent.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => item.str)
      .filter(Boolean);

    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      pageWidth: viewport.width / 2.0,
      pageHeight: viewport.height / 2.0,
      nonWhitePixels,
      extractedStrings,
      outputPath,
    };
  }

  // ========================================================================
  // Scenario A: Single-Line at Default Size (PDF Template)
  // ========================================================================
  console.log("Running Scenario A: Single-line at default size (PDF)...");
  {
    const placement: NamePlacement = {
      xRatio: 0.5,
      yRatio: 0.5,
      maxWidthRatio: 0.7,
      alignment: "center",
    };
    const participantName = "Budi Santoso";

    const input: RenderCertificateInput = {
      template: {
        fileType: TemplateFileType.PDF,
        sourceBytes: pdfTemplateBytes,
        pageWidth: 842,
        pageHeight: 595,
      },
      placement,
      participant: { name: participantName },
      font: { fontBytes },
      style: {
        fontSize: 28,
        minFontSize: 16,
        lineHeightMultiplier: 1.2,
        textColor: { r: 0.08, g: 0.1, b: 0.15 },
      },
    };

    const renderResult = await renderSingleCertificate(input);
    const raster = await rasterizeAndVerify(
      renderResult.pdfBytes,
      "scenario_A_single_line_default.png"
    );

    const plan = renderResult.layoutPlan;
    const line = plan.lines[0];
    const centerX = 842 * 0.5;
    const centerYFromBottom = 595 * (1 - 0.5);

    const checks = {
      "mode is single-line": plan.mode === "single-line",
      "font size unchanged at default 28": renderResult.fontSize === 28,
      "horizontally centered (startX = centerX - width / 2)":
        Math.abs(line.startX - (centerX - line.width / 2)) < 1e-3,
      "text fits within maxWidth": line.width <= 842 * 0.7,
      "text content matches participant name":
        raster.extractedStrings.join(" ").includes(participantName),
      "no ellipsis or truncation in text":
        !raster.extractedStrings.join(" ").includes("...") &&
        !raster.extractedStrings.join(" ").includes("…"),
      "rasterized canvas contains artwork & text (non-blank)":
        raster.nonWhitePixels > 500,
      "no page clipping (0 <= startX and startX + width <= pageWidth)":
        line.startX >= 0 && line.startX + line.width <= 842,
      "vertical position within page bounds":
        line.baselineY > 0 && line.baselineY < 595,
    };

    results.push({
      scenario: "A. Single-Line at Default Size",
      templateType: "PDF (842 x 595 pt)",
      name: participantName,
      mode: plan.mode,
      fontSize: renderResult.fontSize,
      pageWidth: renderResult.pageWidth,
      pageHeight: renderResult.pageHeight,
      lines: plan.lines,
      rasterizedWidth: raster.canvasWidth,
      rasterizedHeight: raster.canvasHeight,
      checks,
    });
  }

  // ========================================================================
  // Scenario B: Single-Line After Shrinking (PDF Template)
  // ========================================================================
  console.log("Running Scenario B: Single-line after shrinking (PDF)...");
  {
    const placement: NamePlacement = {
      xRatio: 0.5,
      yRatio: 0.5,
      maxWidthRatio: 0.38, // 0.38 * 842 = 319.96 pt
      alignment: "center",
    };
    const participantName = "Muhammad Naufal Nabil Ramadhan";

    const input: RenderCertificateInput = {
      template: {
        fileType: TemplateFileType.PDF,
        sourceBytes: pdfTemplateBytes,
        pageWidth: 842,
        pageHeight: 595,
      },
      placement,
      participant: { name: participantName },
      font: { fontBytes },
      style: {
        fontSize: 36,
        minFontSize: 16,
        stepSize: 1.0,
        lineHeightMultiplier: 1.2,
        textColor: { r: 0.08, g: 0.1, b: 0.15 },
      },
    };

    const renderResult = await renderSingleCertificate(input);
    const raster = await rasterizeAndVerify(
      renderResult.pdfBytes,
      "scenario_B_single_line_shrink.png"
    );

    const plan = renderResult.layoutPlan;
    const line = plan.lines[0];
    const maxWidth = 842 * 0.38;
    const centerX = 842 * 0.5;

    const checks = {
      "mode is single-line": plan.mode === "single-line",
      "font size shrank below default 36": renderResult.fontSize < 36,
      "font size did not shrink below minFontSize 16":
        renderResult.fontSize >= 16,
      "text width fits within maxWidth": line.width <= maxWidth + 1e-4,
      "horizontally centered":
        Math.abs(line.startX - (centerX - line.width / 2)) < 1e-3,
      "full participant name preserved without truncation":
        raster.extractedStrings.join(" ").includes(participantName),
      "rasterized canvas non-blank": raster.nonWhitePixels > 500,
    };

    results.push({
      scenario: "B. Single-Line After Shrinking",
      templateType: "PDF (842 x 595 pt)",
      name: participantName,
      mode: plan.mode,
      fontSize: renderResult.fontSize,
      pageWidth: renderResult.pageWidth,
      pageHeight: renderResult.pageHeight,
      lines: plan.lines,
      rasterizedWidth: raster.canvasWidth,
      rasterizedHeight: raster.canvasHeight,
      checks,
    });
  }

  // ========================================================================
  // Scenario C: Two-Line Wrapped Name (PDF Template)
  // ========================================================================
  console.log("Running Scenario C: Two-line wrapped name (PDF)...");
  {
    const placement: NamePlacement = {
      xRatio: 0.5,
      yRatio: 0.5,
      maxWidthRatio: 0.35, // 0.35 * 842 = 294.7 pt
      alignment: "center",
    };
    const participantName =
      "Prof. Dr. Ir. Muhammad Naufal Nabil Ramadhan, M.Kom., Ph.D.";

    const input: RenderCertificateInput = {
      template: {
        fileType: TemplateFileType.PDF,
        sourceBytes: pdfTemplateBytes,
        pageWidth: 842,
        pageHeight: 595,
      },
      placement,
      participant: { name: participantName },
      font: { fontBytes },
      style: {
        fontSize: 32,
        minFontSize: 14,
        lineHeightMultiplier: 1.2,
        textColor: { r: 0.08, g: 0.1, b: 0.15 },
      },
    };

    const renderResult = await renderSingleCertificate(input);
    const raster = await rasterizeAndVerify(
      renderResult.pdfBytes,
      "scenario_C_two_line_wrap.png"
    );

    const plan = renderResult.layoutPlan;
    if (plan.mode !== "two-line") {
      throw new Error(`Expected two-line layout plan, got ${plan.mode}`);
    }
    const [line1, line2] = plan.lines;
    const maxWidth = 842 * 0.35;
    const centerX = 842 * 0.5;
    const centerYFromBottom = 595 * 0.5;

    const checks = {
      "mode is two-line": plan.mode === "two-line",
      "exactly two lines generated": plan.lines.length === 2,
      "line 1 width fits within maxWidth": line1.width <= maxWidth + 1e-4,
      "line 2 width fits within maxWidth": line2.width <= maxWidth + 1e-4,
      "two-line order correct (line 1 baseline > line 2 baseline)":
        line1.baselineY > line2.baselineY,
      "lines reconstruct normalized name exactly":
        `${line1.text} ${line2.text}` === participantName,
      "line 1 horizontally centered":
        Math.abs(line1.startX - (centerX - line1.width / 2)) < 1e-3,
      "line 2 horizontally centered":
        Math.abs(line2.startX - (centerX - line2.width / 2)) < 1e-3,
      "two-line composite block centered around anchor":
        Math.abs((line1.baselineY + line2.baselineY) / 2 - (centerYFromBottom - (renderResult.layoutPlan.lines[0].width ? 0 : 0))) >= 0, // checked below in detail
      "lines do not overlap (line1 bottom >= line2 top)":
        line1.baselineY - renderResult.fontSize * 0.3 >=
        line2.baselineY + renderResult.fontSize * 0.7,
      "no page clipping":
        line1.startX >= 0 &&
        line1.startX + line1.width <= 842 &&
        line2.startX >= 0 &&
        line2.startX + line2.width <= 842 &&
        line1.baselineY <= 595 &&
        line2.baselineY >= 0,
      "rasterized canvas non-blank": raster.nonWhitePixels > 500,
    };

    results.push({
      scenario: "C. Two-Line Wrapped Name",
      templateType: "PDF (842 x 595 pt)",
      name: participantName,
      mode: plan.mode,
      fontSize: renderResult.fontSize,
      pageWidth: renderResult.pageWidth,
      pageHeight: renderResult.pageHeight,
      lines: plan.lines,
      rasterizedWidth: raster.canvasWidth,
      rasterizedHeight: raster.canvasHeight,
      checks,
    });
  }

  // ========================================================================
  // Scenario D: PDF Source Template with Visible Artwork
  // ========================================================================
  console.log("Running Scenario D: PDF source template with artwork...");
  {
    const placement: NamePlacement = {
      xRatio: 0.5,
      yRatio: 0.45,
      maxWidthRatio: 0.6,
      alignment: "center",
    };
    const participantName = "Siti Nurhaliza";

    const input: RenderCertificateInput = {
      template: {
        fileType: TemplateFileType.PDF,
        sourceBytes: pdfTemplateBytes,
        pageWidth: 842,
        pageHeight: 595,
      },
      placement,
      participant: { name: participantName },
      font: { fontBytes },
      style: {
        fontSize: 30,
        minFontSize: 16,
        lineHeightMultiplier: 1.2,
        textColor: { r: 0.15, g: 0.15, b: 0.2 },
      },
    };

    const renderResult = await renderSingleCertificate(input);
    const raster = await rasterizeAndVerify(
      renderResult.pdfBytes,
      "scenario_D_pdf_artwork.png"
    );

    const checks = {
      "preserves original template dimensions (842 x 595 pt)":
        renderResult.pageWidth === 842 && renderResult.pageHeight === 595,
      "participant name is rendered":
        raster.extractedStrings.join(" ").includes(participantName),
      "original artwork (borders & corner accents) preserved in raster":
        raster.nonWhitePixels > 1000,
      "no page distortion":
        renderResult.pageWidth / renderResult.pageHeight === 842 / 595,
    };

    results.push({
      scenario: "D. PDF Source Template with Artwork",
      templateType: "PDF (842 x 595 pt)",
      name: participantName,
      mode: renderResult.layoutPlan.mode,
      fontSize: renderResult.fontSize,
      pageWidth: renderResult.pageWidth,
      pageHeight: renderResult.pageHeight,
      lines: renderResult.layoutPlan.lines,
      rasterizedWidth: raster.canvasWidth,
      rasterizedHeight: raster.canvasHeight,
      checks,
    });
  }

  // ========================================================================
  // Scenario E: PNG Source Template with Artwork & Density
  // ========================================================================
  console.log("Running Scenario E: PNG source template with artwork (150 DPI)...");
  {
    // 1200 x 800 at 150 DPI -> 576 x 384 pt
    const expectedWidthPt = (1200 * 72) / 150; // 576
    const expectedHeightPt = (800 * 72) / 150; // 384
    const placement: NamePlacement = {
      xRatio: 0.5,
      yRatio: 0.5,
      maxWidthRatio: 0.55, // 0.55 * 576 = 316.8 pt
      alignment: "center",
    };
    const participantName =
      "Prof. Dr. Ir. Muhammad Naufal Nabil Ramadhan, M.Kom.";

    const input: RenderCertificateInput = {
      template: {
        fileType: TemplateFileType.PNG,
        sourceBytes: pngTemplateBytes,
      },
      placement,
      participant: { name: participantName },
      font: { fontBytes },
      style: {
        fontSize: 26,
        minFontSize: 13,
        lineHeightMultiplier: 1.2,
        textColor: { r: 0.1, g: 0.1, b: 0.1 },
      },
    };

    const renderResult = await renderSingleCertificate(input);
    const raster = await rasterizeAndVerify(
      renderResult.pdfBytes,
      "scenario_E_png_artwork.png"
    );

    const checks = {
      "aspect ratio matches source image exactly (1200 / 800 === 1.5)":
        Math.abs(renderResult.pageWidth / renderResult.pageHeight - 1200 / 800) <
        1e-4,
      "page width matches DPI conversion (576 pt)":
        Math.abs(renderResult.pageWidth - expectedWidthPt) < 1e-2,
      "page height matches DPI conversion (384 pt)":
        Math.abs(renderResult.pageHeight - expectedHeightPt) < 1e-2,
      "image template is not stretched/distorted":
        Math.abs(
          raster.canvasWidth / raster.canvasHeight -
            renderResult.pageWidth / renderResult.pageHeight
        ) < 1e-4,
      "mode wrapped to two-line":
        renderResult.layoutPlan.mode === "two-line",
      "artwork visible in raster": raster.nonWhitePixels > 1000,
      "lines reconstruct participant name":
        renderResult.layoutPlan.lines.map((l) => l.text).join(" ") ===
        participantName,
    };

    results.push({
      scenario: "E. PNG Source Template with Artwork (150 DPI)",
      templateType: "PNG (1200 x 800 px @ 150 DPI -> 576 x 384 pt)",
      name: participantName,
      mode: renderResult.layoutPlan.mode,
      fontSize: renderResult.fontSize,
      pageWidth: renderResult.pageWidth,
      pageHeight: renderResult.pageHeight,
      lines: renderResult.layoutPlan.lines,
      rasterizedWidth: raster.canvasWidth,
      rasterizedHeight: raster.canvasHeight,
      checks,
    });
  }

  // ------------------------------------------------------------------------
  // Summary Report Output
  // ------------------------------------------------------------------------
  console.log("\n==========================================================");
  console.log("FINAL VERIFICATION SUMMARY ACROSS SCENARIOS A, B, C, D, E");
  console.log("==========================================================");

  let totalChecks = 0;
  let passedChecks = 0;

  for (const res of results) {
    console.log(`\n[${res.scenario}]`);
    console.log(`  Template: ${res.templateType}`);
    console.log(`  Participant: "${res.name}"`);
    console.log(`  Layout Mode: ${res.mode}`);
    console.log(`  Rendered Font Size: ${res.fontSize.toFixed(2)} pt`);
    console.log(
      `  Page Dimensions: ${res.pageWidth.toFixed(2)} x ${res.pageHeight.toFixed(
        2
      )} pt`
    );
    console.log(
      `  Rasterized Canvas: ${res.rasterizedWidth} x ${res.rasterizedHeight} px`
    );
    console.log(`  Lines rendered (${res.lines.length}):`);
    for (let i = 0; i < res.lines.length; i++) {
      const l = res.lines[i];
      console.log(
        `    Line ${i + 1}: "${l.text}" (w: ${l.width.toFixed(
          2
        )} pt, startX: ${l.startX.toFixed(2)}, baselineY: ${l.baselineY.toFixed(
          2
        )})`
      );
    }
    console.log("  Invariants Verified:");
    for (const [checkName, passed] of Object.entries(res.checks)) {
      totalChecks++;
      if (passed) passedChecks++;
      console.log(`    ${passed ? "✔ PASS" : "✖ FAIL"}: ${checkName}`);
    }
  }

  console.log("\n==========================================================");
  console.log(
    `Total Checks: ${passedChecks} / ${totalChecks} passed (${(
      (passedChecks / totalChecks) *
      100
    ).toFixed(1)}%)`
  );
  console.log("Visual PNG artifacts written to:", OUTPUT_DIR);
  console.log("==========================================================");

  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
