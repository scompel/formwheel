(function moldGeometryModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FormwheelMoldGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMoldGeometryApi() {
  "use strict";

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

  function cloneMesh(mesh) {
    return {
      positions: Array.from(mesh.positions),
      normals: Array.from(mesh.normals || []),
      indices: Array.from(mesh.indices),
      bounds: mesh.bounds ? { min: [...mesh.bounds.min], max: [...mesh.bounds.max], size: [...mesh.bounds.size] } : meshBounds(mesh)
    };
  }

  function signedVolume(mesh) {
    let volume = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
      const [a, b, c] = ids.map((id) => mesh.positions.slice(id * 3, id * 3 + 3));
      volume += (
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6;
    }
    return volume;
  }

  function recomputeNormals(mesh) {
    const normals = new Array(mesh.positions.length).fill(0);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ia = mesh.indices[i];
      const ib = mesh.indices[i + 1];
      const ic = mesh.indices[i + 2];
      const a = mesh.positions.slice(ia * 3, ia * 3 + 3);
      const b = mesh.positions.slice(ib * 3, ib * 3 + 3);
      const c = mesh.positions.slice(ic * 3, ic * 3 + 3);
      const u = b.map((value, axis) => value - a[axis]);
      const v = c.map((value, axis) => value - a[axis]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const id of [ia, ib, ic]) {
        normals[id * 3] += normal[0];
        normals[id * 3 + 1] += normal[1];
        normals[id * 3 + 2] += normal[2];
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }
    mesh.normals = normals;
    return mesh;
  }

  function ensurePositive(mesh) {
    if (signedVolume(mesh) < 0) {
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const swap = mesh.indices[i + 1];
        mesh.indices[i + 1] = mesh.indices[i + 2];
        mesh.indices[i + 2] = swap;
      }
    }
    recomputeNormals(mesh);
    mesh.bounds = meshBounds(mesh);
    return mesh;
  }

  function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const next = (i + 1) % points.length;
      area += points[i][0] * points[next][1] - points[next][0] * points[i][1];
    }
    return area / 2;
  }

  function pointInTriangle(point, a, b, c) {
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const c1 = cross(a, b, point);
    const c2 = cross(b, c, point);
    const c3 = cross(c, a, point);
    const hasNegative = c1 < -1e-9 || c2 < -1e-9 || c3 < -1e-9;
    const hasPositive = c1 > 1e-9 || c2 > 1e-9 || c3 > 1e-9;
    return !(hasNegative && hasPositive);
  }

  function triangulatePolygon(input) {
    const points = polygonArea(input) < 0 ? [...input].reverse() : [...input];
    const remaining = points.map((_, index) => index);
    const triangles = [];
    let guard = points.length * points.length;
    while (remaining.length > 3 && guard > 0) {
      guard -= 1;
      let clipped = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const previous = remaining[(i - 1 + remaining.length) % remaining.length];
        const current = remaining[i];
        const next = remaining[(i + 1) % remaining.length];
        const a = points[previous];
        const b = points[current];
        const c = points[next];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (cross <= 1e-9) continue;
        const containsPoint = remaining.some((candidate) =>
          candidate !== previous && candidate !== current && candidate !== next && pointInTriangle(points[candidate], a, b, c)
        );
        if (containsPoint) continue;
        triangles.push([previous, current, next]);
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) throw new Error("The cottle outline could not be triangulated.");
    }
    if (remaining.length === 3) triangles.push([...remaining]);
    return { points, triangles };
  }

  function extrudePolygon(input, height, yOffset = 0) {
    if (!Array.isArray(input) || input.length < 3) throw new Error("An extrusion needs at least three outline points.");
    if (!(height > 0)) throw new Error("Extrusion height must be positive.");
    const { points, triangles } = triangulatePolygon(input);
    const positions = [];
    for (const [x, z] of points) positions.push(x, yOffset, z);
    for (const [x, z] of points) positions.push(x, yOffset + height, z);
    const count = points.length;
    const indices = [];
    for (const [a, b, c] of triangles) {
      indices.push(a, b, c);
      indices.push(count + a, count + c, count + b);
    }
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      indices.push(i, count + i, count + next, i, count + next, next);
    }
    return ensurePositive({ positions, normals: [], indices });
  }

  function boxMesh(width, height, depth, yOffset = 0) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    return extrudePolygon([
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth]
    ], height, yOffset);
  }

  function annularSectorPoints(innerRadius, outerRadius, startAngle, endAngle, segments = 32) {
    const points = [];
    for (let step = 0; step <= segments; step += 1) {
      const angle = startAngle + (endAngle - startAngle) * step / segments;
      points.push([Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius]);
    }
    for (let step = segments; step >= 0; step -= 1) {
      const angle = startAngle + (endAngle - startAngle) * step / segments;
      points.push([Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius]);
    }
    return points;
  }

  function makeAnnularRing(innerRadius, outerRadius, height, segments = 72) {
    const positions = [];
    const indices = [];
    const rings = [[], [], [], []]; // outer bottom/top, inner bottom/top
    for (let index = 0; index < segments; index += 1) {
      const angle = Math.PI * 2 * index / segments;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const vertices = [
        [outerRadius * cosine, 0, outerRadius * sine],
        [outerRadius * cosine, height, outerRadius * sine],
        [innerRadius * cosine, 0, innerRadius * sine],
        [innerRadius * cosine, height, innerRadius * sine]
      ];
      vertices.forEach((vertex, ring) => {
        rings[ring].push(positions.length / 3);
        positions.push(...vertex);
      });
    }
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const [outerBottom, outerTop, innerBottom, innerTop] = rings;
      indices.push(
        outerBottom[index], outerTop[index], outerTop[next], outerBottom[index], outerTop[next], outerBottom[next],
        innerBottom[index], innerBottom[next], innerTop[next], innerBottom[index], innerTop[next], innerTop[index],
        outerBottom[index], outerBottom[next], innerBottom[next], outerBottom[index], innerBottom[next], innerBottom[index],
        outerTop[index], innerTop[index], innerTop[next], outerTop[index], innerTop[next], outerTop[next]
      );
    }
    return ensurePositive({ positions, normals: [], indices });
  }

  function makeCaseHalves(innerRadius, wall, height, options = {}) {
    const outerRadius = innerRadius + wall;
    const flangeDepth = Math.max(5, Number(options.flangeDepth) || 8);
    const flangeWidth = Math.max(8, Number(options.flangeWidth) || 14);
    const rail = Math.max(1, Number(options.guideRail) || 1.8);
    const leftShell = extrudePolygon(annularSectorPoints(innerRadius, outerRadius, Math.PI / 2, Math.PI * 1.5, 42), height);
    const rightShell = extrudePolygon(annularSectorPoints(innerRadius, outerRadius, -Math.PI / 2, Math.PI / 2, 42), height);
    const seamZ = outerRadius + flangeDepth * 0.22;
    const flangeEntries = (side) => [
      { mesh: boxMesh(flangeWidth, height, flangeDepth), translate: [side * flangeWidth / 2, 0, seamZ] },
      { mesh: boxMesh(flangeWidth, height, flangeDepth), translate: [side * flangeWidth / 2, 0, -seamZ] }
    ];
    const leftTongues = [
      { mesh: boxMesh(rail * 1.8, height * 0.72, flangeDepth * 0.38, height * 0.14), translate: [rail * 0.35, 0, seamZ] },
      { mesh: boxMesh(rail * 1.8, height * 0.72, flangeDepth * 0.38, height * 0.14), translate: [rail * 0.35, 0, -seamZ] }
    ];
    const rightGuides = [
      { mesh: boxMesh(rail, height * 0.76, flangeDepth * 0.16, height * 0.12), translate: [rail * 1.45, 0, seamZ - flangeDepth * 0.27] },
      { mesh: boxMesh(rail, height * 0.76, flangeDepth * 0.16, height * 0.12), translate: [rail * 1.45, 0, seamZ + flangeDepth * 0.27] },
      { mesh: boxMesh(rail, height * 0.76, flangeDepth * 0.16, height * 0.12), translate: [rail * 1.45, 0, -seamZ - flangeDepth * 0.27] },
      { mesh: boxMesh(rail, height * 0.76, flangeDepth * 0.16, height * 0.12), translate: [rail * 1.45, 0, -seamZ + flangeDepth * 0.27] }
    ];
    const left = mergeMeshes([{ mesh: leftShell }, ...flangeEntries(-1), ...leftTongues]);
    const right = mergeMeshes([{ mesh: rightShell }, ...flangeEntries(1), ...rightGuides]);
    return {
      left,
      right,
      innerRadius,
      outerRadius,
      outerWidth: outerRadius * 2,
      outerDepth: (outerRadius + flangeDepth) * 2,
      height,
      flangeDepth,
      guideRail: rail
    };
  }

  function sphereMesh(radius = 5, longitudeSegments = 18, latitudeSegments = 10) {
    const positions = [0, radius, 0];
    const indices = [];
    const rings = [];
    for (let latitude = 1; latitude < latitudeSegments; latitude += 1) {
      const phi = Math.PI * latitude / latitudeSegments;
      const ring = [];
      for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
        const theta = Math.PI * 2 * longitude / longitudeSegments;
        ring.push(positions.length / 3);
        positions.push(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
        );
      }
      rings.push(ring);
    }
    const bottom = positions.length / 3;
    positions.push(0, -radius, 0);
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const next = (longitude + 1) % longitudeSegments;
      indices.push(0, rings[0][longitude], rings[0][next]);
      for (let ring = 0; ring < rings.length - 1; ring += 1) {
        indices.push(
          rings[ring][longitude], rings[ring + 1][longitude], rings[ring + 1][next],
          rings[ring][longitude], rings[ring + 1][next], rings[ring][next]
        );
      }
      const lastRing = rings[rings.length - 1];
      indices.push(bottom, lastRing[next], lastRing[longitude]);
    }
    return ensurePositive({ positions, normals: [], indices });
  }

  function makeRegistrationNatches(radius, count = 4, natchRadius = 6) {
    const natch = sphereMesh(natchRadius);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * index / count + Math.PI / 4;
      entries.push({
        mesh: natch,
        translate: [Math.cos(angle) * radius, natchRadius, Math.sin(angle) * radius]
      });
    }
    return mergeMeshes(entries);
  }

  function transformMesh(input, options = {}) {
    const mesh = cloneMesh(input);
    const sourceBounds = mesh.bounds || meshBounds(mesh);
    const scale = Number.isFinite(options.scale) ? options.scale : 1;
    const translate = options.translate || [0, 0, 0];
    const flipY = Boolean(options.flipY);
    const centerX = options.centerX ? (sourceBounds.min[0] + sourceBounds.max[0]) / 2 : 0;
    const centerZ = options.centerZ ? (sourceBounds.min[2] + sourceBounds.max[2]) / 2 : 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] - centerX;
      const y = mesh.positions[i + 1] - sourceBounds.min[1];
      const z = mesh.positions[i + 2] - centerZ;
      mesh.positions[i] = x * scale + translate[0];
      mesh.positions[i + 1] = (flipY ? sourceBounds.size[1] - y : y) * scale + translate[1];
      mesh.positions[i + 2] = z * scale + translate[2];
    }
    if (flipY) {
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const swap = mesh.indices[i + 1];
        mesh.indices[i + 1] = mesh.indices[i + 2];
        mesh.indices[i + 2] = swap;
      }
    }
    return ensurePositive(mesh);
  }

  function mergeMeshes(entries) {
    const merged = { positions: [], normals: [], colors: [], indices: [] };
    for (const entry of entries) {
      const mesh = entry.mesh;
      const translate = entry.translate || [0, 0, 0];
      const color = entry.color || [0.7, 0.7, 0.7];
      const vertexOffset = merged.positions.length / 3;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        merged.positions.push(mesh.positions[i] + translate[0], mesh.positions[i + 1] + translate[1], mesh.positions[i + 2] + translate[2]);
        merged.normals.push(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
        merged.colors.push(...color);
      }
      for (const index of mesh.indices) merged.indices.push(index + vertexOffset);
    }
    merged.bounds = meshBounds(merged);
    return merged;
  }

  function meshAudit(mesh) {
    const edges = new Map();
    const keyFor = (id) => {
      const start = id * 3;
      return [mesh.positions[start], mesh.positions[start + 1], mesh.positions[start + 2]].map((value) => Math.round(value * 1e5)).join(",");
    };
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
      for (let edge = 0; edge < 3; edge += 1) {
        const ends = [keyFor(ids[edge]), keyFor(ids[(edge + 1) % 3])].sort();
        const key = `${ends[0]}|${ends[1]}`;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    return {
      boundaryEdges: Array.from(edges.values()).filter((count) => count !== 2).length,
      signedVolume: signedVolume(mesh),
      triangles: mesh.indices.length / 3
    };
  }

  function stlSize(mesh) {
    const bounds = mesh.bounds || meshBounds(mesh);
    return [bounds.size[0], bounds.size[2], bounds.size[1]];
  }

  function fitsAnyOrientation(size, plate) {
    const permutations = [
      [0, 1, 2], [1, 0, 2], [0, 2, 1],
      [2, 0, 1], [1, 2, 0], [2, 1, 0]
    ];
    const capacity = [plate.width, plate.depth, plate.height];
    return permutations.some((order) => order.every((axis, index) => size[axis] <= capacity[index] + 1e-6));
  }

  function buildKit(sourceInput, options = {}) {
    const source = transformMesh(sourceInput, { centerX: true, centerZ: true });
    const sourceBounds = source.bounds;
    const plasterWall = Math.max(12, Number(options.plasterWall) || 25);
    const plasterBase = Math.max(12, Number(options.plasterBase) || 25);
    const caseWall = Math.max(1.2, Number(options.caseWall ?? options.cottleWall) || 2.4);
    const baseThickness = Math.max(2, Number(options.baseThickness) || 4);
    let sourceRadius = 0;
    let partingHeight = sourceBounds.size[1] * 0.5;
    for (let index = 0; index < source.positions.length; index += 3) {
      const radial = Math.hypot(source.positions[index], source.positions[index + 2]);
      if (radial > sourceRadius) {
        sourceRadius = radial;
        partingHeight = source.positions[index + 1];
      }
    }
    const innerRadius = sourceRadius + plasterWall;
    const caseHeight = sourceBounds.size[1] + plasterBase;
    const caseMold = makeCaseHalves(innerRadius, caseWall, caseHeight, options);
    const openingRadius = Math.max(8, Math.min(sourceRadius, Number(options.openingRadius) || sourceRadius * 0.72));
    const base = makeAnnularRing(openingRadius + 0.6, caseMold.outerRadius + caseMold.flangeDepth, baseThickness);
    const natchRadius = Math.max(4, Math.min(8, Number(options.natchRadius) || 6));
    const natchPathRadius = Math.min(innerRadius - natchRadius - 3, sourceRadius + plasterWall * 0.55);
    const natches = makeRegistrationNatches(natchPathRadius, 4, natchRadius);
    const sourceVolume = Math.abs(signedVolume(source));
    const plasterVolumeMl = Math.max(0, (Math.PI * innerRadius * innerRadius * caseHeight - sourceVolume) / 1000);
    const parts = { former: source, left: caseMold.left, right: caseMold.right, base, natches };
    const partSizes = Object.fromEntries(Object.entries(parts).map(([name, mesh]) => [name, stlSize(mesh)]));
    return {
      parts,
      partSizes,
      sourceBounds,
      sourceRadius,
      plasterVolumeMl,
      innerRadius,
      innerWidth: innerRadius * 2,
      innerDepth: innerRadius * 2,
      outerWidth: caseMold.outerWidth,
      outerDepth: caseMold.outerDepth,
      caseHeight,
      cottleHeight: caseHeight,
      baseThickness,
      partingHeight,
      natchRadius,
      natchPathRadius,
      registration: "four rounded natches",
      caseGuide: "tongue-and-groove seam rails"
    };
  }

  function parseStl(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error("The STL reader needs an ArrayBuffer.");
    if (arrayBuffer.byteLength < 15) throw new Error("The STL file is empty or incomplete.");
    const view = new DataView(arrayBuffer);
    let rawPositions = [];
    let triangleCount = 0;
    const expectedTriangles = arrayBuffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
    const isBinary = arrayBuffer.byteLength >= 84 && 84 + expectedTriangles * 50 === arrayBuffer.byteLength;

    if (isBinary) {
      triangleCount = expectedTriangles;
      let offset = 84;
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        offset += 12;
        const vertices = [];
        for (let vertex = 0; vertex < 3; vertex += 1) {
          const x = view.getFloat32(offset, true);
          const y = view.getFloat32(offset + 4, true);
          const z = view.getFloat32(offset + 8, true);
          vertices.push([x, z, y]);
          offset += 12;
        }
        rawPositions.push(...vertices[0], ...vertices[2], ...vertices[1]);
        offset += 2;
      }
    } else {
      const text = new TextDecoder().decode(arrayBuffer);
      const matches = Array.from(text.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g));
      if (matches.length < 3 || matches.length % 3 !== 0) throw new Error("This does not appear to be a valid binary or ASCII STL.");
      triangleCount = matches.length / 3;
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const vertices = [0, 1, 2].map((offset) => {
          const match = matches[triangle * 3 + offset];
          return [Number(match[1]), Number(match[3]), Number(match[2])];
        });
        rawPositions.push(...vertices[0], ...vertices[2], ...vertices[1]);
      }
    }

    const positions = rawPositions;
    const indices = Array.from({ length: triangleCount * 3 }, (_, index) => index);
    let mesh = ensurePositive({ positions, normals: [], indices });
    mesh = transformMesh(mesh, { centerX: true, centerZ: true });
    if (mesh.bounds.size.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("The STL does not contain a usable three-dimensional solid.");
    mesh.triangleCount = triangleCount;
    return mesh;
  }

  return {
    meshBounds,
    cloneMesh,
    signedVolume,
    recomputeNormals,
    ensurePositive,
    extrudePolygon,
    boxMesh,
    makeAnnularRing,
    makeCaseHalves,
    makeRegistrationNatches,
    transformMesh,
    mergeMeshes,
    meshAudit,
    stlSize,
    fitsAnyOrientation,
    buildKit,
    parseStl
  };
});
