import path from "path";
import fs from "fs/promises";
import { FontNotConfiguredError } from "./errors";

/**
 * Production Font Registry
 *
 * Maps approved font identifiers to project-bundled font asset files.
 * Currently NOT CONFIGURED for production per project decision.
 * The test-only font under tests/fixtures must NEVER be placed here.
 */
export const PRODUCTION_FONT_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  // Production fonts will be provisioned in a future phase.
});

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
      `Font asset identifier "${identifier}" is not configured in the font registry. Real production font remains NOT CONFIGURED.`
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
