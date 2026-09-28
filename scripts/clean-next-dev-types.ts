import { existsSync, realpathSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const buildRoot = resolve(process.cwd(), ".next");
const target = join(buildRoot, "dev", "types");

if (existsSync(target)) {
  const actual = realpathSync(target);
  const withinBuildRoot = relative(buildRoot, actual);
  if (!withinBuildRoot || withinBuildRoot.startsWith("..") || withinBuildRoot.startsWith(sep)) {
    throw new Error("Refusing to remove generated types outside .next");
  }
  rmSync(actual, { recursive: true, force: true });
}
