const test = require("node:test");
const assert = require("node:assert/strict");
const geometry = require("../geometry.js");

function meshAudit(mesh) {
  const edges = new Map();
  let signedVolume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = ids[edge];
      const b = ids[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    const [a, b, c] = ids.map((id) => mesh.positions.slice(id * 3, id * 3 + 3));
    signedVolume += (
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
  return {
    boundaryEdges: Array.from(edges.values()).filter((count) => count !== 2).length,
    signedVolume
  };
}

function stlAudit(buffer) {
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let signedVolume = 0;
  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    offset += 12;
    const points = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const point = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
      offset += 12;
      points.push(point);
      point.forEach((value, axis) => {
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      });
    }
    const [a, b, c] = points;
    signedVolume += (
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
    offset += 2;
  }
  return { size: max.map((value, axis) => value - min[axis]), signedVolume };
}

test("shrinkage compensation returns the required inverse scale", () => {
  assert.equal(geometry.shrinkageScale(0), 1);
  assert.ok(Math.abs(geometry.shrinkageScale(12) - 1.136363636) < 1e-8);
});

test("preset sampling preserves endpoints and produces a smooth dense curve", () => {
  const profile = geometry.PRESETS.bowl;
  const sampled = geometry.sampleProfile(profile, 12);
  assert.deepEqual({ z: sampled[0].z, r: sampled[0].r }, profile[0]);
  assert.deepEqual(
    { z: sampled.at(-1).z, r: sampled.at(-1).r },
    profile.at(-1)
  );
  assert.ok(sampled.length > profile.length * 8);
  assert.ok(sampled.every((point, index) => index === 0 || point.z > sampled[index - 1].z));
});

test("undercut analysis distinguishes a bowl from a narrow-neck vase", () => {
  assert.equal(geometry.analyzeProfile(geometry.PRESETS.bowl).hasUndercut, false);
  assert.equal(geometry.analyzeProfile(geometry.PRESETS.vase).hasUndercut, true);
});

test("solid mesh is closed by indexed side walls and two caps", () => {
  const radialSegments = 32;
  const mesh = geometry.buildSolidMesh(geometry.PRESETS.cup, { radialSegments, samplesPerSegment: 8 });
  assert.equal(mesh.indices.length % 3, 0);
  assert.ok(mesh.positions.length > 0);
  assert.equal(mesh.bounds.size[1], 112);
  assert.ok(Math.abs(mesh.bounds.size[0] - 98) < 1e-6);
  const stl = geometry.binaryStl(mesh, "test");
  const view = new DataView(stl);
  assert.equal(view.getUint32(80, true), mesh.indices.length / 3);
  assert.equal(stl.byteLength, 84 + (mesh.indices.length / 3) * 50);
  const exported = stlAudit(stl);
  assert.ok(Math.abs(exported.size[2] - 112) < 1e-4, "STL height should be on the Z axis");
  assert.ok(Math.abs(exported.size[1] - 98) < 1e-4, "STL depth should be on the Y axis");
  assert.ok(exported.signedVolume > 0, "STL should retain positive orientation after axis conversion");
  const audit = meshAudit(mesh);
  assert.equal(audit.boundaryEdges, 0);
  assert.ok(audit.signedVolume > 0);
});

test("solid caps face outward and remain visible with back-face culling", () => {
  const radialSegments = 24;
  const samplesPerSegment = 6;
  const mesh = geometry.buildSolidMesh(geometry.PRESETS.cup, { radialSegments, samplesPerSegment });
  const triangleNormalY = (triangleIndex) => {
    const ids = mesh.indices.slice(triangleIndex * 3, triangleIndex * 3 + 3);
    const [a, b, c] = ids.map((id) => mesh.positions.slice(id * 3, id * 3 + 3));
    const u = b.map((value, axis) => value - a[axis]);
    const v = c.map((value, axis) => value - a[axis]);
    return u[2] * v[0] - u[0] * v[2];
  };
  const sideTriangles = (geometry.sampleProfile(geometry.PRESETS.cup, samplesPerSegment).length - 1) * radialSegments * 2;
  assert.ok(triangleNormalY(sideTriangles) < 0, "bottom cap should face -Y");
  assert.ok(triangleNormalY(sideTriangles + radialSegments) > 0, "top cap should face +Y");
});

test("print former adds a flared slip well above the vessel rim", () => {
  const scale = geometry.shrinkageScale(12);
  const former = geometry.buildFormerMesh(geometry.PRESETS.bowl, {
    radialSegments: 32,
    samplesPerSegment: 8,
    scale,
    slipWellHeight: 24,
    slipWellFlare: 9
  });
  assert.ok(Math.abs(former.bounds.size[1] - (96 * scale + 24)) < 1e-6);
  assert.ok(former.bounds.size[0] > 146 * scale);
  const audit = meshAudit(former);
  assert.equal(audit.boundaryEdges, 0);
  assert.ok(audit.signedVolume > 0);
});

test("hollow vessel mesh has a cavity and printable bounds", () => {
  const mesh = geometry.buildVesselMesh(geometry.PRESETS.bowl, { radialSegments: 32, samplesPerSegment: 8, wall: 3, base: 5 });
  assert.equal(mesh.indices.length % 3, 0);
  assert.equal(mesh.bounds.size[1], 96);
  const analysis = geometry.analyzeProfile(geometry.PRESETS.bowl, { wall: 3, base: 5 });
  assert.ok(analysis.capacityMl > 700);
  assert.ok(analysis.capacityMl < 1600);
  const audit = meshAudit(mesh);
  assert.equal(audit.boundaryEdges, 0);
  assert.ok(audit.signedVolume > 0);
});

test("resizeProfile matches requested envelope", () => {
  const resized = geometry.resizeProfile(geometry.PRESETS.bowl, 150, 120);
  const analysis = geometry.analyzeProfile(resized);
  assert.ok(Math.abs(analysis.height - 150) < 1e-6);
  assert.ok(Math.abs(analysis.diameter - 120) < 1e-6);
});
