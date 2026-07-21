#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

function comparePaths(a, b) {
  return a.localeCompare(b);
}

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(`${text}\0`, offset, length, "ascii");
}

function checksumHeader(header) {
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of copy) sum += byte;
  return sum;
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  const normalized = path.replaceAll("\\", "/");
  if (Buffer.byteLength(normalized) > 100) throw new Error(`Archive path exceeds tar limit: ${normalized}`);
  header.write(normalized, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("root", 265, 32, "ascii");
  header.write("root", 297, 32, "ascii");
  writeOctal(header, 148, 8, checksumHeader(header));
  return header;
}

async function walk(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = resolve(current, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in release archive: ${path}`);
    if (entry.isDirectory()) files.push(...await walk(root, absolute));
    else if (entry.isFile()) files.push({ path, absolute });
    else throw new Error(`Unsupported release archive entry: ${path}`);
  }
  return files.sort((a, b) => comparePaths(a.path, b.path));
}

async function build(sourceDirectory, outputPath) {
  const root = resolve(sourceDirectory);
  const chunks = [];
  for (const file of await walk(root)) {
    const stats = await lstat(file.absolute);
    if (!stats.isFile()) throw new Error(`Not a regular file: ${file.path}`);
    const data = await readFile(file.absolute);
    chunks.push(tarHeader(file.path, data.length), data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  const archive = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
  await writeFile(outputPath, archive);
  console.log(`ARCHIVED: ${sourceDirectory} -> ${outputPath}`);
  console.log(`SHA256: ${createHash("sha256").update(archive).digest("hex")}`);
}

function parseTar(archive) {
  const tar = gunzipSync(archive);
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const path = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!path || path.startsWith("/") || path.includes("../") || path.includes("\\")) throw new Error(`Unsafe archive path: ${path}`);
    if (entries.has(path)) throw new Error(`Duplicate archive entry: ${path}`);
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = header.subarray(156, 157).toString("ascii");
    if (type !== "0" && type !== "\0") throw new Error(`Unsupported archive entry type for ${path}`);
    const dataStart = offset + 512;
    entries.set(path, Buffer.from(tar.subarray(dataStart, dataStart + size)));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function verify(sourceDirectory, archivePath) {
  const sourceFiles = await walk(resolve(sourceDirectory));
  const entries = parseTar(await readFile(archivePath));
  const expected = sourceFiles.map((file) => file.path).sort(comparePaths);
  const actual = [...entries.keys()].sort(comparePaths);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((path) => !entries.has(path));
    const unexpected = actual.filter((path) => !expected.includes(path));
    throw new Error(`Archive file list does not match package directory. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}.`);
  }
  for (const file of sourceFiles) {
    const source = await readFile(file.absolute);
    const archived = entries.get(file.path);
    if (!archived?.equals(source)) throw new Error(`Archive content mismatch: ${file.path}`);
  }
  console.log(`PASS: archive ${archivePath} matches ${sourceDirectory} (${expected.length} files)`);
}

const [command, sourceDirectory, archivePath] = process.argv.slice(2);
if (!sourceDirectory || !archivePath || !["build", "verify"].includes(command)) {
  console.error("Usage: node scripts/release-archive.mjs build|verify <package-directory> <archive.tgz>");
  process.exitCode = 2;
} else {
  try {
    if (command === "build") await build(sourceDirectory, archivePath);
    else await verify(sourceDirectory, archivePath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
