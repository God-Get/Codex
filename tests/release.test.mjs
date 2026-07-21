import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildReleasePackage,
  signReleaseManifest,
  unpackReleasePackage,
  verifyReleaseManifest,
  verifyReleaseManifestSignature,
  verifyReleasePackage,
  writeEd25519KeyPair,
  writePreparedReleaseManifest
} from "../packages/release/dist/index.js";

test("release manifests are checksummed, signed, verified, packaged, and safely unpacked", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-release-"));
  try {
    await mkdir(join(root, "schemas"), { recursive: true });
    await mkdir(join(root, "examples"), { recursive: true });
    await writeFile(join(root, "schemas", "sample.json"), "{\"type\":\"object\"}\n", "utf8");
    await writeFile(join(root, "examples", "sample.json"), "{\"id\":\"PROJ-0001\"}\n", "utf8");

    const sourceManifest = join(root, "manifest.json");
    const preparedManifest = join(root, "manifest.prepared.json");
    await writeFile(sourceManifest, `${JSON.stringify({
      id: "RELEASE-0001",
      name: "Test release",
      version: "0.1.0",
      status: "draft",
      releasedAt: null,
      components: { core: "0.1.0", release: "0.1.0" },
      artifacts: ["schemas/sample.json"],
      conformanceFixtures: ["examples/sample.json"]
    }, null, 2)}\n`, "utf8");

    const prepared = await writePreparedReleaseManifest(sourceManifest, preparedManifest, root);
    assert.match(prepared.checksums["schemas/sample.json"], /^[a-f0-9]{64}$/);
    assert.equal((await verifyReleaseManifest(preparedManifest, root)).valid, true);
    await assert.rejects(() => buildReleasePackage(preparedManifest, root, root), /must not be the repository root/);

    const privateKey = join(root, "keys", "private.pem");
    const publicKey = join(root, "keys", "public.pem");
    const signature = join(root, "manifest.sig.json");
    const keyId = await writeEd25519KeyPair(privateKey, publicKey);
    assert.match(keyId, /^sha256:[a-f0-9]{64}$/);
    const envelope = await signReleaseManifest(preparedManifest, privateKey, signature);
    assert.equal(envelope.algorithm, "Ed25519");
    assert.equal(await verifyReleaseManifestSignature(preparedManifest, signature, publicKey), true);

    const packageDirectory = join(root, "package");
    const packageResult = await buildReleasePackage(preparedManifest, packageDirectory, root);
    assert.equal(packageResult.fileCount, 6);
    assert.equal((await verifyReleasePackage(packageDirectory)).valid, true);
    assert.match(await readFile(join(packageDirectory, "CHECKSUMS.sha256"), "utf8"), /schemas\/sample\.json/);
    const sbom = JSON.parse(await readFile(join(packageDirectory, "bom.cdx.json"), "utf8"));
    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.equal(sbom.specVersion, "1.7");

    const unpacked = join(root, "unpacked");
    const unpackResult = await unpackReleasePackage(packageDirectory, unpacked);
    assert.equal(unpackResult.fileCount, 6);
    assert.equal(await readFile(join(unpacked, "schemas", "sample.json"), "utf8"), "{\"type\":\"object\"}\n");

    await writeFile(join(packageDirectory, "unexpected.txt"), "unexpected\n", "utf8");
    const unexpectedReport = await verifyReleasePackage(packageDirectory);
    assert.equal(unexpectedReport.valid, false);
    assert.equal(unexpectedReport.items.some((item) => item.reason === "unexpected-file"), true);
    await assert.rejects(() => unpackReleasePackage(packageDirectory, join(root, "refused")), /refusing to unpack/);

    await writeFile(join(root, "schemas", "sample.json"), "tampered\n", "utf8");
    const invalidReport = await verifyReleaseManifest(preparedManifest, root);
    assert.equal(invalidReport.valid, false);
    assert.equal(invalidReport.items.some((item) => item.reason === "checksum-mismatch"), true);
    assert.equal(await verifyReleaseManifestSignature(sourceManifest, signature, publicKey), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
