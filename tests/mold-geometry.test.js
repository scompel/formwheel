const test = require("node:test");
const assert = require("node:assert/strict");
const geometry = require("../geometry.js");
const mold = require("../mold-geometry.js");

test("case mold derives a circular 25 mm plaster envelope from its source", () => {
  const source = geometry.buildSolidMesh(geometry.PRESETS.bowl, { radialSegments: 48, samplesPerSegment: 10 });
  const kit = mold.buildKit(source, { plasterWall: 25, plasterBase: 25, caseWall: 2.4, baseThickness: 4 });
  assert.ok(Math.abs(kit.innerWidth - 196) < 1e-6);
  assert.ok(Math.abs(kit.innerDepth - 196) < 1e-6);
  assert.ok(Math.abs(kit.cottleHeight - 121) < 1e-6);
  assert.ok(Math.abs(kit.outerWidth - 200.8) < 1e-6);
  assert.ok(kit.outerDepth > kit.outerWidth, "clamp flanges should extend beyond the circular case");
  assert.ok(kit.plasterVolumeMl > 2500);
  assert.equal(kit.registration, "four rounded natches");
  assert.equal(kit.caseGuide, "tongue-and-groove seam rails");
});

test("all generated mold tooling parts are closed and positive", () => {
  const source = geometry.buildSolidMesh(geometry.PRESETS.cup, { radialSegments: 32, samplesPerSegment: 8 });
  const kit = mold.buildKit(source);
  for (const [name, mesh] of Object.entries(kit.parts)) {
    const audit = mold.meshAudit(mesh);
    assert.equal(audit.boundaryEdges, 0, `${name} should be two-manifold`);
    assert.ok(audit.signedVolume > 0, `${name} should have positive volume`);
  }
});

test("binary STL round-trip retains slicer Z-up height", () => {
  const source = geometry.buildSolidMesh(geometry.PRESETS.cup, { radialSegments: 32, samplesPerSegment: 8 });
  const stl = geometry.binaryStl(source, "round-trip");
  const parsed = mold.parseStl(stl);
  assert.ok(Math.abs(parsed.bounds.size[1] - 112) < 1e-4);
  assert.ok(Math.abs(parsed.bounds.size[0] - 98) < 1e-4);
  assert.ok(Math.abs(parsed.bounds.size[2] - 98) < 1e-4);
  assert.equal(parsed.triangleCount, source.indices.length / 3);
});

test("printer fit accepts rotated parts but rejects impossible parts", () => {
  const plate = { width: 256, depth: 256, height: 256 };
  assert.equal(mold.fitsAnyOrientation([300, 20, 200], plate), false);
  assert.equal(mold.fitsAnyOrientation([250, 20, 200], plate), true);
  assert.equal(mold.fitsAnyOrientation([260, 260, 10], plate), false);
});

test("inverting a former preserves positive orientation and envelope", () => {
  const source = geometry.buildSolidMesh(geometry.PRESETS.vase, { radialSegments: 32, samplesPerSegment: 8 });
  const inverted = mold.transformMesh(source, { flipY: true, translate: [0, 4, 0], centerX: true, centerZ: true });
  assert.ok(mold.signedVolume(inverted) > 0);
  assert.ok(Math.abs(inverted.bounds.min[1] - 4) < 1e-6);
  assert.ok(Math.abs(inverted.bounds.size[1] - 198) < 1e-6);
});
