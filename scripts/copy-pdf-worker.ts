import fs from "fs";
import path from "path";

/**
 * Automates copying the matching pdfjs-dist worker to public/pdf.worker.min.mjs
 * to ensure client-side PDF.js worker always matches the runtime library version.
 */
function copyPdfWorker() {
  const sourcePath = path.resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"
  );
  const pkgPath = path.resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/package.json"
  );
  const destDir = path.resolve(process.cwd(), "public");
  const destPath = path.resolve(destDir, "pdf.worker.min.mjs");

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `pdfjs-dist worker not found at ${sourcePath}. Please ensure pdfjs-dist is installed.`
    );
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const version = pkgJson.version;

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(sourcePath, destPath);
  const stats = fs.statSync(destPath);

  console.log(
    `[pdfjs-worker] Copied pdfjs-dist@${version} worker (${(
      stats.size / 1024
    ).toFixed(1)} KB) to ${destPath}`
  );
}

copyPdfWorker();
