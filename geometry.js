(function geometryModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FormwheelGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGeometryApi() {
  "use strict";

  const PRESETS = {
    bowl: [
      { z: 0, r: 31 },
      { z: 14, r: 39 },
      { z: 42, r: 55 },
      { z: 74, r: 68 },
      { z: 96, r: 73 }
    ],
    cup: [
      { z: 0, r: 38 },
      { z: 12, r: 41 },
      { z: 46, r: 44 },
      { z: 88, r: 47 },
      { z: 112, r: 49 }
    ],
    vase: [
      { z: 0, r: 35 },
      { z: 22, r: 53 },
      { z: 76, r: 65 },
      { z: 126, r: 48 },
      { z: 168, r: 35 },
      { z: 198, r: 42 }
    ],
    urn: [
      { z: 0, r: 36 },
      { z: 18, r: 48 },
      { z: 62, r: 68 },
      { z: 118, r: 72 },
      { z: 164, r: 54 },
      { z: 194, r: 43 },
      { z: 214, r: 48 }
    ]
  };

  const cloneProfile = (profile) => profile.map((point) => ({ z: point.z, r: point.r }));

  function normalizeProfile(profile) {
    if (!Array.isArray(profile) || profile.length < 2) throw new Error("A profile needs at least two points.");
    const cleaned = profile
      .map((point) => ({ z: Number(point.z), r: Number(point.r) }))
      .filter((point) => Number.isFinite(point.z) && Number.isFinite(point.r))
      .sort((a, b) => a.z - b.z)
      .map((point) => ({ z: Math.max(0, point.z), r: Math.max(0.5, point.r) }));
    if (cleaned.length < 2) throw new Error("A profile needs at least two valid points.");
    cleaned[0].z = 0;
    for (let i = 1; i < cleaned.length; i += 1) {
      if (cleaned[i].z <= cleaned[i - 1].z) cleaned[i].z = cleaned[i - 1].z + 0.1;
    }
    return cleaned;
  }

  function pchipTangents(profile) {
    const n = profile.length;
    const h = [];
    const delta = [];
    for (let i = 0; i < n - 1; i += 1) {
      h[i] = profile[i + 1].z - profile[i].z;
      delta[i] = (profile[i + 1].r - profile[i].r) / h[i];
    }
    if (n === 2) return [delta[0], delta[0]];

    const m = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i += 1) {
      if (delta[i - 1] === 0 || delta[i] === 0 || Math.sign(delta[i - 1]) !== Math.sign(delta[i])) {
        m[i] = 0;
      } else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
      }
    }

    m[0] = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1]);
    if (Math.sign(m[0]) !== Math.sign(delta[0])) m[0] = 0;
    else if (Math.sign(delta[0]) !== Math.sign(delta[1]) && Math.abs(m[0]) > Math.abs(3 * delta[0])) m[0] = 3 * delta[0];

    const last = n - 1;
    m[last] = ((2 * h[last - 1] + h[last - 2]) * delta[last - 1] - h[last - 1] * delta[last - 2]) / (h[last - 1] + h[last - 2]);
    if (Math.sign(m[last]) !== Math.sign(delta[last - 1])) m[last] = 0;
    else if (Math.sign(delta[last - 1]) !== Math.sign(delta[last - 2]) && Math.abs(m[last]) > Math.abs(3 * delta[last - 1])) m[last] = 3 * delta[last - 1];
    return m;
  }

  function sampleProfile(input, samplesPerSegment = 18) {
    const profile = normalizeProfile(input);
    const tangents = pchipTangents(profile);
    const output = [];
    for (let i = 0; i < profile.length - 1; i += 1) {
      const p0 = profile[i];
      const p1 = profile[i + 1];
      const h = p1.z - p0.z;
      for (let step = 0; step < samplesPerSegment; step += 1) {
        const t = step / samplesPerSegment;
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        const r = h00 * p0.r + h10 * h * tangents[i] + h01 * p1.r + h11 * h * tangents[i + 1];
        const dh00 = 6 * t2 - 6 * t;
        const dh10 = 3 * t2 - 4 * t + 1;
        const dh01 = -6 * t2 + 6 * t;
        const dh11 = 3 * t2 - 2 * t;
        const drDz = (dh00 * p0.r + dh10 * h * tangents[i] + dh01 * p1.r + dh11 * h * tangents[i + 1]) / h;
        output.push({ z: p0.z + t * h, r: Math.max(0.5, r), drDz });
      }
    }
    const final = profile[profile.length - 1];
    output.push({ z: final.z, r: final.r, drDz: tangents[tangents.length - 1] });
    return output;
  }

  function interpolateRadius(sampled, z) {
    if (z <= sampled[0].z) return sampled[0].r;
    if (z >= sampled[sampled.length - 1].z) return sampled[sampled.length - 1].r;
    let low = 0;
    let high = sampled.length - 1;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (sampled[mid].z < z) low = mid;
      else high = mid;
    }
    const a = sampled[low];
    const b = sampled[high];
    const t = (z - a.z) / (b.z - a.z);
    return a.r + (b.r - a.r) * t;
  }

  function addVertex(mesh, x, y, z, nx, ny, nz) {
    mesh.positions.push(x, y, z);
    mesh.normals.push(nx, ny, nz);
    return mesh.positions.length / 3 - 1;
  }

  function addRing(mesh, radius, y, drDz, radialSegments, inward = false) {
    const ring = [];
    const normalLength = Math.hypot(1, drDz) || 1;
    for (let i = 0; i < radialSegments; i += 1) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const sign = inward ? -1 : 1;
      ring.push(addVertex(
        mesh,
        radius * Math.cos(theta), y, radius * Math.sin(theta),
        sign * Math.cos(theta) / normalLength,
        sign * -drDz / normalLength,
        sign * Math.sin(theta) / normalLength
      ));
    }
    return ring;
  }

  function connectRings(mesh, lower, upper, inward = false) {
    const n = lower.length;
    for (let i = 0; i < n; i += 1) {
      const next = (i + 1) % n;
      if (inward) {
        mesh.indices.push(lower[i], upper[next], upper[i], lower[i], lower[next], upper[next]);
      } else {
        mesh.indices.push(lower[i], upper[i], upper[next], lower[i], upper[next], lower[next]);
      }
    }
  }

  function addDisc(mesh, ring, y, direction) {
    const center = addVertex(mesh, 0, y, 0, 0, direction, 0);
    for (let i = 0; i < ring.length; i += 1) {
      const next = (i + 1) % ring.length;
      // The rings run clockwise when viewed from +Y. Keep the triangle
      // winding consistent with the requested outward cap normal so WebGL
      // back-face culling does not hide the top and bottom.
      if (direction > 0) mesh.indices.push(center, ring[next], ring[i]);
      else mesh.indices.push(center, ring[i], ring[next]);
    }
  }

  function buildSolidMesh(input, options = {}) {
    const radialSegments = Math.max(12, Math.round(options.radialSegments || 96));
    const verticalSamples = Math.max(4, Math.round(options.samplesPerSegment || 18));
    const scale = Number.isFinite(options.scale) ? options.scale : 1;
    const sampled = sampleProfile(input, verticalSamples).map((point) => ({
      z: point.z * scale,
      r: point.r * scale,
      drDz: point.drDz
    }));
    const mesh = { positions: [], normals: [], indices: [] };
    const rings = sampled.map((point) => addRing(mesh, point.r, point.z, point.drDz, radialSegments));
    for (let row = 0; row < rings.length - 1; row += 1) connectRings(mesh, rings[row], rings[row + 1]);
    addDisc(mesh, rings[0], sampled[0].z, -1);
    addDisc(mesh, rings[rings.length - 1], sampled[sampled.length - 1].z, 1);
    mesh.bounds = meshBounds(mesh);
    return mesh;
  }

  function buildFormerMesh(input, options = {}) {
    const scale = Number.isFinite(options.scale) ? options.scale : 1;
    const slipWellHeight = Math.max(8, Number(options.slipWellHeight) || 26);
    const slipWellFlare = Math.max(3, Number(options.slipWellFlare) || 10);
    const shoulderHeight = Math.min(6, slipWellHeight * 0.28);
    const profile = normalizeProfile(input).map((point) => ({ z: point.z * scale, r: point.r * scale }));
    const rim = profile[profile.length - 1];
    profile.push(
      { z: rim.z + shoulderHeight, r: rim.r + slipWellFlare },
      { z: rim.z + slipWellHeight, r: rim.r + slipWellFlare }
    );
    return buildSolidMesh(profile, {
      radialSegments: options.radialSegments,
      samplesPerSegment: options.samplesPerSegment,
      scale: 1
    });
  }

  function buildVesselMesh(input, options = {}) {
    const radialSegments = Math.max(12, Math.round(options.radialSegments || 96));
    const verticalSamples = Math.max(4, Math.round(options.samplesPerSegment || 18));
    const wall = Math.max(0.5, Number(options.wall) || 3);
    const base = Math.max(wall, Number(options.base) || 5);
    const sampled = sampleProfile(input, verticalSamples);
    const topZ = sampled[sampled.length - 1].z;
    if (base >= topZ) throw new Error("Base thickness must be smaller than the vessel height.");

    const innerSampled = [{ z: base, r: Math.max(0.5, interpolateRadius(sampled, base) - wall), drDz: 0 }];
    for (const point of sampled) {
      if (point.z > base + 0.01) innerSampled.push({ z: point.z, r: Math.max(0.5, point.r - wall), drDz: point.drDz });
    }

    const mesh = { positions: [], normals: [], indices: [] };
    const outerRings = sampled.map((point) => addRing(mesh, point.r, point.z, point.drDz, radialSegments));
    const innerRings = innerSampled.map((point) => addRing(mesh, point.r, point.z, point.drDz, radialSegments, true));
    for (let row = 0; row < outerRings.length - 1; row += 1) connectRings(mesh, outerRings[row], outerRings[row + 1]);
    for (let row = 0; row < innerRings.length - 1; row += 1) connectRings(mesh, innerRings[row], innerRings[row + 1], true);
    addDisc(mesh, outerRings[0], sampled[0].z, -1);

    const outerTop = outerRings[outerRings.length - 1];
    const innerTop = innerRings[innerRings.length - 1];
    for (let i = 0; i < radialSegments; i += 1) {
      const next = (i + 1) % radialSegments;
      mesh.indices.push(outerTop[i], innerTop[i], innerTop[next], outerTop[i], innerTop[next], outerTop[next]);
    }
    addDisc(mesh, innerRings[0], base, 1);
    mesh.bounds = meshBounds(mesh);
    return mesh;
  }

  function meshBounds(mesh) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[i + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[i + axis]);
      }
    }
    return { min, max, size: max.map((value, axis) => value - min[axis]) };
  }

  function analyzeProfile(input, options = {}) {
    const sampled = sampleProfile(input, 24);
    const wall = Math.max(0, Number(options.wall) || 0);
    const base = Math.max(0, Number(options.base) || 0);
    const maxRadius = Math.max(...sampled.map((point) => point.r));
    const height = sampled[sampled.length - 1].z;
    const undercutSegments = sampled.filter((point) => point.drDz < -0.015);
    const lowDraftSegments = sampled.filter((point) => point.drDz >= -0.015 && point.drDz < Math.tan(Math.PI / 180));
    let capacityMm3 = 0;
    for (let i = 0; i < sampled.length - 1; i += 1) {
      const a = sampled[i];
      const b = sampled[i + 1];
      if (b.z <= base) continue;
      const z0 = Math.max(a.z, base);
      const z1 = b.z;
      if (z1 <= z0) continue;
      const r0 = Math.max(0, interpolateRadius(sampled, z0) - wall);
      const r1 = Math.max(0, b.r - wall);
      capacityMm3 += Math.PI * (z1 - z0) * (r0 * r0 + r0 * r1 + r1 * r1) / 3;
    }
    return {
      height,
      diameter: maxRadius * 2,
      capacityMl: capacityMm3 / 1000,
      hasUndercut: undercutSegments.length > 0,
      undercutCount: undercutSegments.length,
      hasLowDraft: lowDraftSegments.length > 0,
      minimumDraftDegrees: Math.atan(Math.min(...sampled.map((point) => point.drDz))) * 180 / Math.PI
    };
  }

  function resizeProfile(input, height, diameter) {
    const profile = normalizeProfile(input);
    const currentHeight = profile[profile.length - 1].z;
    const currentDiameter = Math.max(...profile.map((point) => point.r)) * 2;
    const zScale = height / currentHeight;
    const rScale = diameter / currentDiameter;
    return profile.map((point) => ({ z: point.z * zScale, r: point.r * rScale }));
  }

  function shrinkageScale(percent) {
    const fraction = Math.max(0, Math.min(0.95, Number(percent) / 100));
    return 1 / (1 - fraction);
  }

  function binaryStl(mesh, name = "formwheel") {
    const triangleCount = Math.floor(mesh.indices.length / 3);
    const buffer = new ArrayBuffer(84 + triangleCount * 50);
    const view = new DataView(buffer);
    const header = new TextEncoder().encode(`Formwheel ${name}`.slice(0, 80));
    new Uint8Array(buffer, 0, header.length).set(header);
    view.setUint32(80, triangleCount, true);
    let offset = 84;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      // Preview geometry is Y-up. STL/slicer geometry is Z-up. Swapping Y/Z
      // changes handedness, so reverse each triangle while converting axes.
      const ids = [mesh.indices[triangle * 3], mesh.indices[triangle * 3 + 2], mesh.indices[triangle * 3 + 1]];
      const points = ids.map((id) => {
        const point = mesh.positions.slice(id * 3, id * 3 + 3);
        return [point[0], point[2], point[1]];
      });
      const u = points[1].map((value, axis) => value - points[0][axis]);
      const v = points[2].map((value, axis) => value - points[0][axis]);
      let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal) || 1;
      normal = normal.map((value) => value / length);
      for (const value of normal) { view.setFloat32(offset, value, true); offset += 4; }
      for (const point of points) {
        for (const value of point) { view.setFloat32(offset, value, true); offset += 4; }
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
    return buffer;
  }

  function profileSvg(input) {
    const sampled = sampleProfile(input, 24);
    const height = sampled[sampled.length - 1].z;
    const maxRadius = Math.max(...sampled.map((point) => point.r));
    const path = sampled.map((point, index) => `${index === 0 ? "M" : "L"} ${point.r.toFixed(3)} ${(height - point.z).toFixed(3)}`).join(" ");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxRadius.toFixed(3)} ${height.toFixed(3)}" width="${maxRadius.toFixed(3)}mm" height="${height.toFixed(3)}mm"><path d="${path}" fill="none" stroke="black" stroke-width="0.5"/></svg>`;
  }

  return {
    PRESETS,
    cloneProfile,
    normalizeProfile,
    sampleProfile,
    analyzeProfile,
    resizeProfile,
    shrinkageScale,
    buildSolidMesh,
    buildFormerMesh,
    buildVesselMesh,
    binaryStl,
    profileSvg,
    meshBounds
  };
});
