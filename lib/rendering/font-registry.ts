import path from "path";
import fs from "fs/promises";
import { FontNotConfiguredError } from "./errors";

export interface ProductionFont {
  id: string;
  family: "DM Sans";
  weight: number;
  label: string;
  style: "normal" | "italic";
  assetPath: string;
}

export const PRODUCTION_FONTS: readonly ProductionFont[] = Object.freeze([
  { id: "dm-sans-light", family: "DM Sans", weight: 300, label: "Light", style: "normal", assetPath: "public/fonts/DMSans-Light.ttf" },
  { id: "dm-sans-regular", family: "DM Sans", weight: 400, label: "Regular", style: "normal", assetPath: "public/fonts/DMSans-Regular.ttf" },
  { id: "dm-sans-italic", family: "DM Sans", weight: 400, label: "Italic", style: "italic", assetPath: "public/fonts/DMSans-Italic.ttf" },
  { id: "dm-sans-medium", family: "DM Sans", weight: 500, label: "Medium", style: "normal", assetPath: "public/fonts/DMSans-Medium.ttf" },
  { id: "dm-sans-semibold", family: "DM Sans", weight: 600, label: "SemiBold", style: "normal", assetPath: "public/fonts/DMSans-SemiBold.ttf" },
  { id: "dm-sans-bold", family: "DM Sans", weight: 700, label: "Bold", style: "normal", assetPath: "public/fonts/DMSans-Bold.ttf" },
]);

export const PRODUCTION_FONT_REGISTRY: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(PRODUCTION_FONTS.map((font) => [font.id, font.assetPath]))
);

export function getProductionFont(identifier: string): ProductionFont | undefined {
  return PRODUCTION_FONTS.find((font) => font.id === identifier);
}

/**
 * Isolated Test Font Registry
 *
 * ONLY active during unit/integration tests (NODE_ENV === 'test' or VITEST).
 * Never accessible in production.
 */
const TEST_FONT_REGISTRY: Record<string, string> = {};

/**
 * Registers an isolated test font identifier for automated testing only.
 * Throws in production environments.
 */
export function registerTestFont(identifier: string, relativePath: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("registerTestFont cannot be called in production environment");
  }
  TEST_FONT_REGISTRY[identifier] = relativePath;
}

/**
 * Clears test font registry (for test cleanup).
 */
export function clearTestFontRegistry(): void {
  for (const key of Object.keys(TEST_FONT_REGISTRY)) {
    delete TEST_FONT_REGISTRY[key];
  }
}

/**
 * Resolves deterministic font bytes from a trusted font identifier.
 *
 * Security:
 * - Does NOT allow arbitrary filesystem paths from database fields.
 * - Looks up identifier in the controlled registry.
 * - Resolves safely within the project root directory.
 * - In production, test fonts are strictly inaccessible.
 */
export async function resolveFontBytes(
  fontAssetPath: string | null | undefined
): Promise<Uint8Array> {
  if (!fontAssetPath || fontAssetPath.trim().length === 0) {
    throw new FontNotConfiguredError(
      "Deterministic font asset is not configured or fontAssetPath is empty."
    );
  }

  const identifier = fontAssetPath.trim();
  let relativeAssetPath: string | undefined = PRODUCTION_FONT_REGISTRY[identifier];

  // In test environment only, check test registry fallback
  const isTestEnv =
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.PLAYWRIGHT_TEST);

  if (!relativeAssetPath && isTestEnv) {
    relativeAssetPath = TEST_FONT_REGISTRY[identifier];
  }

  if (!relativeAssetPath) {
    throw new FontNotConfiguredError(
      `Font asset identifier "${identifier}" is not configured in the font registry.`
    );
  }

  const projectRoot = process.cwd();
  const resolvedPath = path.resolve(/*turbopackIgnore: true*/ projectRoot, relativeAssetPath);

  // Path traversal guard: must reside within projectRoot
  if (!resolvedPath.startsWith(projectRoot)) {
    throw new FontNotConfiguredError(
      `Font asset path resolution escaped project root for identifier "${identifier}".`
    );
  }

  try {
    const bytes = await fs.readFile(resolvedPath);
    if (bytes.length === 0) {
      throw new FontNotConfiguredError(
        `Font asset file at "${relativeAssetPath}" is empty.`
      );
    }
    return new Uint8Array(bytes);
  } catch (error) {
    if (error instanceof FontNotConfiguredError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new FontNotConfiguredError(
      `Failed to read font asset file for identifier "${identifier}": ${message}`
    );
  }
}
