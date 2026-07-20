import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export interface ReleaseManifest {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  status: string;
  releasedAt: string | null;
  components: Record<string, string>;
  artifacts: string[];
  conformanceFixtures: string[];
  checksums?: Record<string, string>;
}

export interface ReleaseVerificationItem {
  path: string;
  expected?: string;
  actual?: string;
  ok: boolean;
  reason?: "missing-checksum" | "missing-file" | "checksum-mismatch";
}

export interface ReleaseVerificationReport {
  valid: boolean;
  releaseId: string;
  version: string;
  items: ReleaseVerificationItem[];
}

export interface ReleasePackageResult {
  outputDirectory: string;
  fileCount: number;
  releaseId: string;
  version: string;
}

function releasePaths(manifest: ReleaseManifest): string[] {
  return [...new Set([...manifest.artifacts, ...manifest.conformanceFixtures])].sort();
}

function resolveInside(rootDirectory: string, relativePath: string): string {
  const root = resolve(rootDirectory);
  const target = resolve(root, relativePath);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(prefix)) {
    throw new Error(`Release path escapes repository root: ${relativePath}`);
  }
  return target;
}

export async function readReleaseManifest(manifestPath: string): Promise<ReleaseManifest> {
  const value = JSON.parse(await readFile(manifestPath, "utf8")) as ReleaseManifest;
  if (!value || typeof value !== "object" || !Array.isArray(value.artifacts) || !Array.isArray(value.conformanceFixtures)) {
    throw new Error(`Invalid release manifest: ${manifestPath}`);
  }
  return value;
}

export async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export async function prepareReleaseManifest(
  manifestPath: string,
  rootDirectory = process.cwd()
): Promise<ReleaseManifest> {
  const manifest = await readReleaseManifest(manifestPath);
  const checksums: Record<string, string> = {};
  for (const relativePath of releasePaths(manifest)) {
    checksums[relativePath] = await sha256File(resolveInside(rootDirectory, relativePath));
  }
  return { ...manifest, checksums };
}

export async function writePreparedReleaseManifest(
  manifestPath: string,
  outputPath: string,
  rootDirectory = process.cwd()
): Promise<ReleaseManifest> {
  const prepared = await prepareReleaseManifest(manifestPath, rootDirectory);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
  return prepared;
}

export async function verifyReleaseManifest(
  manifestPath: string,
  rootDirectory = process.cwd()
): Promise<ReleaseVerificationReport> {
  const manifest = await readReleaseManifest(manifestPath);
  const items: ReleaseVerificationItem[] = [];

  for (const relativePath of releasePaths(manifest)) {
    const expected = manifest.checksums?.[relativePath];
    if (!expected) {
      items.push({ path: relativePath, ok: false, reason: "missing-checksum" });
      continue;
    }

    try {
      const actual = await sha256File(resolveInside(rootDirectory, relativePath));
      items.push({
        path: relativePath,
        expected,
        actual,
        ok: actual === expected,
        ...(actual === expected ? {} : { reason: "checksum-mismatch" as const })
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") {
        items.push({ path: relativePath, expected, ok: false, reason: "missing-file" });
      } else {
        throw error;
      }
    }
  }

  return {
    valid: items.every((item) => item.ok),
    releaseId: manifest.id,
    version: manifest.version,
    items
  };
}

export async function buildReleasePackage(
  manifestPath: string,
  outputDirectory: string,
  rootDirectory = process.cwd()
): Promise<ReleasePackageResult> {
  const verification = await verifyReleaseManifest(manifestPath, rootDirectory);
  if (!verification.valid) {
    const failures = verification.items.filter((item) => !item.ok).map((item) => `${item.path}: ${item.reason}`).join(", ");
    throw new Error(`Release verification failed: ${failures}`);
  }

  const manifest = await readReleaseManifest(manifestPath);
  const output = resolve(outputDirectory);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const relativePath of releasePaths(manifest)) {
    const source = resolveInside(rootDirectory, relativePath);
    const destination = resolveInside(output, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  await copyFile(resolve(manifestPath), resolve(output, "manifest.json"));
  const checksumLines = releasePaths(manifest).map((relativePath) => `${manifest.checksums?.[relativePath]}  ${relativePath}`);
  await writeFile(resolve(output, "CHECKSUMS.sha256"), `${checksumLines.join("\n")}\n`, "utf8");
  await writeFile(
    resolve(output, "codex-package.json"),
    `${JSON.stringify({
      format: "codex-package",
      formatVersion: "0.1.0",
      releaseId: manifest.id,
      releaseVersion: manifest.version,
      manifest: "manifest.json",
      checksums: "CHECKSUMS.sha256"
    }, null, 2)}\n`,
    "utf8"
  );

  return {
    outputDirectory: output,
    fileCount: releasePaths(manifest).length + 3,
    releaseId: manifest.id,
    version: manifest.version
  };
}
