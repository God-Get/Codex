import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildReleasePackage,
  verifyReleaseManifest,
  writePreparedReleaseManifest
} from "../packages/release/dist/index.js";

test("release manifests are checksummed, verified, and packaged", async () => {
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
      components: { core: "0.1.0" },
      artifacts: ["schemas/sample.json"],
      conformanceFixtures: ["examples/sample.json"]
    }, null, 2)}\n`, "utf8");

    const prepared = await writePreparedReleaseManifest(sourceManifest, preparedManifest, root);
    assert.match(prepared.checksums["schemas/sample.json"], /^[a-f0-9]{64}$/);
    assert.match(prepared.checksums["examples/sample.json"], /^[a-f0-9]{64}$/);

    const validReport = await verifyReleaseManifest(preparedManifest, root);
    assert.equal(validReport.valid, true);
    assert.equal(validReport.items.length, 2);
    await assert.rejects(
      () => buildReleasePackage(preparedManifest, root, root),
      /must not be the repository root/
    );

    const packageDirectory = join(root, "package");
    const packageResult = await buildReleasePackage(preparedManifest, packageDirectory, root);
    assert.equal(packageResult.fileCount, 5);
    assert.match(await readFile(join(packageDirectory, "CHECKSUMS.sha256"), "utf8"), /schemas\/sample\.json/);
    assert.equal(JSON.parse(await readFile(join(packageDirectory, "codex-package.json"), "utf8")).format, "codex-package");
    assert.equal(await readFile(join(packageDirectory, "schemas", "sample.json"), "utf8"), "{\"type\":\"object\"}\n");

    await writeFile(join(root, "schemas", "sample.json"), "tampered\n", "utf8");
    const invalidReport = await verifyReleaseManifest(preparedManifest, root);
    assert.equal(invalidReport.valid, false);
    assert.equal(invalidReport.items.some((item) => item.reason === "checksum-mismatch"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
