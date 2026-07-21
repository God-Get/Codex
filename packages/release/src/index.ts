import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export interface ReleaseManifest {
  $schema?: string;
  formatVersion?: string;
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
  reason?: "missing-checksum" | "missing-file" | "checksum-mismatch" | "unsafe-entry" | "unexpected-file";
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

export interface PackageDescriptor {
  format: "codex-package";
  formatVersion: string;
  releaseId: string;
  releaseVersion: string;
  manifest: string;
  checksums: string;
  sbom?: string;
}

export interface ManifestSignature {
  format: "codex-manifest-signature";
  formatVersion: "0.1.0";
  algorithm: "Ed25519";
  keyId: string;
  signedFile: string;
  signature: string;
}

function releasePaths(manifest: ReleaseManifest): string[] {
  return [...new Set([...manifest.artifacts, ...manifest.conformanceFixtures])].sort();
}

function resolveInside(rootDirectory: string, relativePath: string): string {
  const root = resolve(rootDirectory);
  const target = resolve(root, relativePath);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error(`Path escapes root directory: ${relativePath}`);
  return target;
}

async function assertRegularFile(rootDirectory: string, relativePath: string): Promise<string> {
  const path = resolveInside(rootDirectory, relativePath);
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Unsafe package entry: ${relativePath}`);
  return path;
}

async function walkFiles(rootDirectory: string, currentDirectory = rootDirectory): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
    const absolute = resolve(currentDirectory, entry.name);
    const rel = relative(rootDirectory, absolute).split(sep).join("/");
    if (entry.isSymbolicLink()) throw new Error(`Unsafe package entry: ${rel}`);
    if (entry.isDirectory()) result.push(...await walkFiles(rootDirectory, absolute));
    else if (entry.isFile()) result.push(rel);
    else throw new Error(`Unsafe package entry: ${rel}`);
  }
  return result.sort();
}

export async function readReleaseManifest(manifestPath: string): Promise<ReleaseManifest> {
  const value = JSON.parse(await readFile(manifestPath, "utf8")) as ReleaseManifest;
  if (!value || typeof value !== "object" || !Array.isArray(value.artifacts) || !Array.isArray(value.conformanceFixtures)) {
    throw new Error(`Invalid release manifest: ${manifestPath}`);
  }
  return value;
}

export async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function prepareReleaseManifest(manifestPath: string, rootDirectory = process.cwd()): Promise<ReleaseManifest> {
  const manifest = await readReleaseManifest(manifestPath);
  const checksums: Record<string, string> = {};
  for (const path of releasePaths(manifest)) checksums[path] = await sha256File(await assertRegularFile(rootDirectory, path));
  return { ...manifest, checksums };
}

export async function writePreparedReleaseManifest(manifestPath: string, outputPath: string, rootDirectory = process.cwd()): Promise<ReleaseManifest> {
  const prepared = await prepareReleaseManifest(manifestPath, rootDirectory);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
  return prepared;
}

export async function verifyReleaseManifest(manifestPath: string, rootDirectory = process.cwd()): Promise<ReleaseVerificationReport> {
  const manifest = await readReleaseManifest(manifestPath);
  const items: ReleaseVerificationItem[] = [];
  for (const path of releasePaths(manifest)) {
    const expected = manifest.checksums?.[path];
    if (!expected) {
      items.push({ path, ok: false, reason: "missing-checksum" });
      continue;
    }
    try {
      const actual = await sha256File(await assertRegularFile(rootDirectory, path));
      items.push({ path, expected, actual, ok: actual === expected, ...(actual === expected ? {} : { reason: "checksum-mismatch" as const }) });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      items.push({ path, expected, ok: false, reason: code === "ENOENT" ? "missing-file" : "unsafe-entry" });
    }
  }
  return { valid: items.every((item) => item.ok), releaseId: manifest.id, version: manifest.version, items };
}

export function createCycloneDxSbom(manifest: ReleaseManifest): object {
  const componentRefs = Object.entries(manifest.components)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => `pkg:npm/@codex/${name}@${version}`);
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: `urn:uuid:${createHash("sha256").update(`${manifest.id}:${manifest.version}`).digest("hex").slice(0, 8)}-0000-4000-8000-${createHash("sha256").update(manifest.id).digest("hex").slice(0, 12)}`,
    version: 1,
    metadata: {
      timestamp: manifest.releasedAt ?? "1970-01-01T00:00:00.000Z",
      component: { type: "application", name: manifest.name, version: manifest.version, "bom-ref": manifest.id }
    },
    components: Object.entries(manifest.components).sort(([a], [b]) => a.localeCompare(b)).map(([name, version]) => ({
      type: "library",
      name: `@codex/${name}`,
      version,
      "bom-ref": `pkg:npm/@codex/${name}@${version}`,
      purl: `pkg:npm/%40codex/${name}@${version}`
    })),
    dependencies: [{ ref: manifest.id, dependsOn: componentRefs }]
  };
}

export async function buildReleasePackage(manifestPath: string, outputDirectory: string, rootDirectory = process.cwd()): Promise<ReleasePackageResult> {
  const verification = await verifyReleaseManifest(manifestPath, rootDirectory);
  if (!verification.valid) {
    const failures = verification.items.filter((item) => !item.ok).map((item) => `${item.path}: ${item.reason}`).join(", ");
    throw new Error(`Release verification failed: ${failures}`);
  }
  const manifest = await readReleaseManifest(manifestPath);
  const root = resolve(rootDirectory);
  const output = resolveInside(root, outputDirectory);
  if (output === root) throw new Error("Package output directory must not be the repository root.");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const path of releasePaths(manifest)) {
    const destination = resolveInside(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(await assertRegularFile(root, path), destination);
  }
  await copyFile(resolve(manifestPath), resolve(output, "manifest.json"));
  await writeFile(resolve(output, "CHECKSUMS.sha256"), `${releasePaths(manifest).map((path) => `${manifest.checksums?.[path]}  ${path}`).join("\n")}\n`, "utf8");
  await writeFile(resolve(output, "bom.cdx.json"), `${JSON.stringify(createCycloneDxSbom(manifest), null, 2)}\n`, "utf8");
  const descriptor: PackageDescriptor = {
    format: "codex-package",
    formatVersion: "0.1.0",
    releaseId: manifest.id,
    releaseVersion: manifest.version,
    manifest: "manifest.json",
    checksums: "CHECKSUMS.sha256",
    sbom: "bom.cdx.json"
  };
  await writeFile(resolve(output, "codex-package.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  return { outputDirectory: output, fileCount: releasePaths(manifest).length + 4, releaseId: manifest.id, version: manifest.version };
}

export async function verifyReleasePackage(packageDirectory: string): Promise<ReleaseVerificationReport> {
  const root = resolve(packageDirectory);
  const descriptor = JSON.parse(await readFile(await assertRegularFile(root, "codex-package.json"), "utf8")) as PackageDescriptor;
  if (descriptor.format !== "codex-package") throw new Error("Invalid CODEX package descriptor.");
  await assertRegularFile(root, descriptor.checksums);
  if (descriptor.sbom) await assertRegularFile(root, descriptor.sbom);
  const manifestPath = await assertRegularFile(root, descriptor.manifest);
  const manifest = await readReleaseManifest(manifestPath);
  if (descriptor.releaseId !== manifest.id || descriptor.releaseVersion !== manifest.version) throw new Error("Package descriptor does not match release manifest.");
  const report = await verifyReleaseManifest(manifestPath, root);
  const expectedFiles = new Set([...releasePaths(manifest), descriptor.manifest, descriptor.checksums, "codex-package.json", ...(descriptor.sbom ? [descriptor.sbom] : [])]);
  for (const path of await walkFiles(root)) if (!expectedFiles.has(path)) report.items.push({ path, ok: false, reason: "unexpected-file" });
  report.valid = report.items.every((item) => item.ok);
  return report;
}

export async function unpackReleasePackage(packageDirectory: string, outputDirectory: string): Promise<ReleasePackageResult> {
  const report = await verifyReleasePackage(packageDirectory);
  if (!report.valid) throw new Error("Package verification failed; refusing to unpack.");
  const source = resolve(packageDirectory);
  const output = resolve(outputDirectory);
  if (source === output) throw new Error("Package source and output directories must differ.");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const files = await walkFiles(source);
  for (const path of files) {
    const destination = resolveInside(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(await assertRegularFile(source, path), destination);
  }
  return { outputDirectory: output, fileCount: files.length, releaseId: report.releaseId, version: report.version };
}

export function generateEd25519KeyPair(): { privateKey: string; publicKey: string; keyId: string } {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { privateKey, publicKey, keyId: `sha256:${createHash("sha256").update(publicKey).digest("hex")}` };
}

export async function writeEd25519KeyPair(privateKeyPath: string, publicKeyPath: string): Promise<string> {
  const keys = generateEd25519KeyPair();
  await mkdir(dirname(resolve(privateKeyPath)), { recursive: true });
  await mkdir(dirname(resolve(publicKeyPath)), { recursive: true });
  await writeFile(privateKeyPath, keys.privateKey, { encoding: "utf8", mode: 0o600 });
  await writeFile(publicKeyPath, keys.publicKey, "utf8");
  return keys.keyId;
}

export async function signReleaseManifest(manifestPath: string, privateKeyPath: string, signaturePath: string): Promise<ManifestSignature> {
  const data = await readFile(manifestPath);
  const privateKey = await readFile(privateKeyPath, "utf8");
  const publicPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const envelope: ManifestSignature = {
    format: "codex-manifest-signature",
    formatVersion: "0.1.0",
    algorithm: "Ed25519",
    keyId: `sha256:${createHash("sha256").update(publicPem).digest("hex")}`,
    signedFile: manifestPath,
    signature: sign(null, data, privateKey).toString("base64")
  };
  await writeFile(signaturePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  return envelope;
}

export async function verifyReleaseManifestSignature(manifestPath: string, signaturePath: string, publicKeyPath: string): Promise<boolean> {
  const envelope = JSON.parse(await readFile(signaturePath, "utf8")) as ManifestSignature;
  if (envelope.format !== "codex-manifest-signature" || envelope.algorithm !== "Ed25519") return false;
  const publicKey = await readFile(publicKeyPath, "utf8");
  const keyId = `sha256:${createHash("sha256").update(publicKey).digest("hex")}`;
  if (envelope.keyId !== keyId) return false;
  return verify(null, await readFile(manifestPath), publicKey, Buffer.from(envelope.signature, "base64"));
}
