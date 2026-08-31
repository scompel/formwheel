(function formwheelApp() {
  "use strict";

  const geometry = window.FormwheelGeometry;
  const STORAGE_KEY = "formwheel.design.v1";
  const DEFAULTS = {
    name: "Untitled vessel",
    profile: geometry.cloneProfile(geometry.PRESETS.bowl),
    shrinkage: 12,
    wall: 3,
    base: 5,
    plate: { width: 256, depth: 256, height: 256 },
    wheel: { shown: false, diameter: 320 }
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const elements = {
    designName: $("#design-name"),
    reset: $("#reset-design"),
    undo: $("#undo"),
    redo: $("#redo"),
    profileCanvas: $("#profile-canvas"),
    pointNudger: $("#point-nudger"),
    selectedPointLabel: $("#selected-point-label"),
    extendX: $("#extend-x"),
    extendY: $("#extend-y"),
    glCanvas: $("#gl-canvas"),
    wheelCanvas: $("#wheel-underlay"),
    wheelVisual: $("#wheel-visual"),
    overlayCanvas: $("#stage-overlay"),
    stageWrap: $(".stage-wrap"),
    height: $("#height"),
    diameter: $("#diameter"),
    shrinkage: $("#shrinkage"),
    wall: $("#wall"),
    base: $("#base"),
    plateWidth: $("#plate-width"),
    plateDepth: $("#plate-depth"),
    plateHeight: $("#plate-height"),
    metricHeight: $("#metric-height"),
    metricDiameter: $("#metric-diameter"),
    metricCapacity: $("#metric-capacity"),
    metricFit: $("#metric-fit"),
    formerSize: $("#former-size"),
    scaleFactor: $("#scale-factor"),
    moldStatus: $("#mold-status"),
    spin: $("#spin-control"),
    showWheel: $("#show-wheel"),
    wheelDiameter: $("#wheel-diameter"),
    wheelSizeField: $("#wheel-size-field"),
    scaleStamp: $("#scale-stamp"),
    saveState: $("#save-state"),
    exportFormer: $("#export-former"),
    exportVessel: $("#export-vessel"),
    exportProfile: $("#export-profile"),
    importProfile: $("#import-profile"),
    exportSvg: $("#export-svg"),
    toast: $("#toast")
  };

  let state = loadState();
  let viewMode = "fired";
  let selectedPoint = null;
  let draggingPoint = null;
  let dragSnapshot = null;
  let undoStack = [];
  let redoStack = [];
  let saveTimer = 0;
  let toastTimer = 0;
  let dimensionTimer = 0;
  let dimensionSnapshot = null;
  let currentMesh = null;
  let editorView = initialEditorView(state.profile);
  let wheelAngle = -0.35;
  let autoSpin = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function validNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function initialEditorView(profile) {
    const height = profile[profile.length - 1].z;
    const radius = Math.max(...profile.map((point) => point.r));
    return {
      maxZ: Math.ceil((height + 8) / 10) * 10,
      maxR: Math.ceil((radius + 8) / 10) * 10
    };
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored || !Array.isArray(stored.profile)) return structuredClone(DEFAULTS);
      return {
        name: typeof stored.name === "string" ? stored.name : DEFAULTS.name,
        profile: geometry.normalizeProfile(stored.profile),
        shrinkage: validNumber(stored.shrinkage, DEFAULTS.shrinkage),
        wall: validNumber(stored.wall, DEFAULTS.wall),
        base: validNumber(stored.base, DEFAULTS.base),
        plate: {
          width: validNumber(stored.plate?.width, DEFAULTS.plate.width),
          depth: validNumber(stored.plate?.depth, DEFAULTS.plate.depth),
          height: validNumber(stored.plate?.height, DEFAULTS.plate.height)
        },
        wheel: {
          shown: Boolean(stored.wheel?.shown),
          diameter: validNumber(stored.wheel?.diameter, DEFAULTS.wheel.diameter)
        }
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  function scheduleSave() {
    elements.saveState.textContent = "Saving…";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elements.saveState.textContent = "Saved locally";
    }, 180);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
  }

  function slugify(value) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vessel";
  }

  function download(data, filename, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function snapshotProfile() {
    return geometry.cloneProfile(state.profile);
  }

  function recordHistory(snapshot = snapshotProfile()) {
    undoStack.push(snapshot);
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    elements.undo.disabled = undoStack.length === 0;
    elements.redo.disabled = redoStack.length === 0;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotProfile());
    state.profile = undoStack.pop();
    selectedPoint = null;
    refreshAll();
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotProfile());
    state.profile = redoStack.pop();
    selectedPoint = null;
    refreshAll();
    updateHistoryButtons();
  }

  function valuesFromState() {
    const analysis = geometry.analyzeProfile(state.profile, { wall: state.wall, base: state.base });
    elements.designName.value = state.name;
    elements.height.value = Math.round(analysis.height * 10) / 10;
    elements.diameter.value = Math.round(analysis.diameter * 10) / 10;
    elements.shrinkage.value = state.shrinkage;
    elements.wall.value = state.wall;
    elements.base.value = state.base;
    elements.plateWidth.value = state.plate.width;
    elements.plateDepth.value = state.plate.depth;
    elements.plateHeight.value = state.plate.height;
    elements.showWheel.checked = state.wheel.shown;
    elements.wheelDiameter.value = state.wheel.diameter;
    elements.wheelSizeField.hidden = !state.wheel.shown;
  }

  function refreshAll(options = {}) {
    state.profile = geometry.normalizeProfile(state.profile);
    const analysis = geometry.analyzeProfile(state.profile, { wall: state.wall, base: state.base });
    const scale = geometry.shrinkageScale(state.shrinkage);
    const formerDiameter = analysis.diameter * scale;
    const formerHeight = analysis.height * scale;
    const fits = formerDiameter <= state.plate.width && formerDiameter <= state.plate.depth && formerHeight <= state.plate.height;

    if (!options.keepDimensions) {
      elements.height.value = formatInput(analysis.height);
      elements.diameter.value = formatInput(analysis.diameter);
    }
    elements.metricHeight.textContent = formatMm(viewMode === "former" ? formerHeight : analysis.height);
    elements.metricDiameter.textContent = formatMm(viewMode === "former" ? formerDiameter : analysis.diameter);
    elements.metricCapacity.textContent = analysis.capacityMl >= 1000 ? `${(analysis.capacityMl / 1000).toFixed(2)} L` : `${Math.round(analysis.capacityMl)} mL`;
    elements.metricFit.textContent = fits ? "Fits" : "Too large";
    elements.metricFit.style.color = fits ? "var(--sage-600)" : "var(--error-600)";
    elements.formerSize.textContent = `Ø ${formerDiameter.toFixed(1)} × ${formerHeight.toFixed(1)} mm`;
    elements.scaleFactor.textContent = `${state.shrinkage.toFixed(1)}% shrinkage → former scaled ${scale.toFixed(3)}×`;
    elements.scaleStamp.textContent = viewMode === "former" ? `Print former · ${scale.toFixed(3)}×` : "Final piece · 1:1";

    updateMoldStatus(analysis);
    updatePresetState();
    drawProfileEditor();
    rebuildMesh();
    drawWheelUnderlay();
    drawStageOverlay();
    scheduleSave();
  }

  function formatMm(value) { return `${value.toFixed(value >= 100 ? 0 : 1)} mm`; }
  function formatInput(value) { return String(Math.round(value * 10) / 10); }

  function updateMoldStatus(analysis) {
    if (analysis.hasUndercut) {
      elements.moldStatus.classList.add("is-warning");
      elements.moldStatus.innerHTML = `
        <span class="status-mark" aria-hidden="true">!</span>
        <div><strong>Split mold required</strong><p>The profile narrows above a wider section. A one-piece plaster mold would trap the former.</p></div>`;
    } else if (analysis.hasLowDraft) {
      elements.moldStatus.classList.remove("is-warning");
      elements.moldStatus.innerHTML = `
        <span class="status-mark" aria-hidden="true">≈</span>
        <div><strong>Single pull, low draft</strong><p>The profile has nearly vertical areas. Seal the former well and expect a tighter release.</p></div>`;
    } else {
      elements.moldStatus.classList.remove("is-warning");
      elements.moldStatus.innerHTML = `
        <span class="status-mark" aria-hidden="true">✓</span>
        <div><strong>Single-pull profile</strong><p>This former can release upward from a one-piece plaster mold.</p></div>`;
    }
  }

  function updatePresetState() {
    $$(".preset").forEach((button) => {
      const preset = geometry.PRESETS[button.dataset.preset];
      const same = preset.length === state.profile.length && preset.every((point, index) =>
        Math.abs(point.z - state.profile[index].z) < 0.01 && Math.abs(point.r - state.profile[index].r) < 0.01
      );
      button.classList.toggle("is-active", same);
    });
  }

  // Profile editor ---------------------------------------------------------

  function sizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width: rect.width, height: rect.height, dpr };
  }

  function profileMap() {
    const rect = elements.profileCanvas.getBoundingClientRect();
    const pad = { top: 26, right: 24, bottom: 48, left: 46 };
    const maxZ = editorView.maxZ;
    const maxR = editorView.maxR;
    const usableWidth = Math.max(1, rect.width - pad.left - pad.right);
    const usableHeight = Math.max(1, rect.height - pad.top - pad.bottom);
    return {
      pad,
      width: rect.width,
      height: rect.height,
      maxZ,
      maxR,
      toCanvas(point) {
        return { x: pad.left + point.r / maxR * usableWidth, y: rect.height - pad.bottom - point.z / maxZ * usableHeight };
      },
      toProfile(x, y) {
        return {
          r: Math.max(1, Math.min(maxR, (x - pad.left) / usableWidth * maxR)),
          z: Math.max(0, Math.min(maxZ, (rect.height - pad.bottom - y) / usableHeight * maxZ))
        };
      }
    };
  }

  function drawProfileEditor() {
    const { dpr } = sizeCanvas(elements.profileCanvas);
    const ctx = elements.profileCanvas.getContext("2d");
    const map = profileMap();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, map.width, map.height);
    drawProfileGrid(ctx, map);

    const sampled = geometry.sampleProfile(state.profile, 30);
    ctx.beginPath();
    const first = map.toCanvas(sampled[0]);
    ctx.moveTo(map.pad.left, first.y);
    for (const point of sampled) {
      const screen = map.toCanvas(point);
      ctx.lineTo(screen.x, screen.y);
    }
    const last = map.toCanvas(sampled[sampled.length - 1]);
    ctx.lineTo(map.pad.left, last.y);
    ctx.closePath();
    const fill = ctx.createLinearGradient(map.pad.left, 0, map.width, 0);
    fill.addColorStop(0, "rgba(167, 86, 58, 0.05)");
    fill.addColorStop(1, "rgba(167, 86, 58, 0.18)");
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 0; i < sampled.length - 1; i += 1) {
      const a = map.toCanvas(sampled[i]);
      const b = map.toCanvas(sampled[i + 1]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = sampled[i].drDz < -0.015 ? "#a73c2f" : "#4b3229";
      ctx.stroke();
    }

    state.profile.forEach((point, index) => {
      const screen = map.toCanvas(point);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, index === selectedPoint ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = index === selectedPoint ? "#9c4d35" : "#f8f3e9";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#4b3229";
      ctx.stroke();
    });
    updatePointNudger();
  }

  function updatePointNudger() {
    const point = selectedPoint === null ? null : state.profile[selectedPoint];
    elements.pointNudger.hidden = !point;
    if (!point) return;
    elements.selectedPointLabel.textContent = `Point ${selectedPoint + 1} · X ${point.r.toFixed(1)} · Y ${point.z.toFixed(1)}`;
  }

  function extendAxis(axis) {
    if (axis === "x") editorView.maxR += 10;
    else editorView.maxZ += 10;
    drawProfileEditor();
    showToast(`${axis.toUpperCase()} axis extended to ${axis === "x" ? editorView.maxR : editorView.maxZ} mm.`);
  }

  function nudgeSelected(axis, amount) {
    if (selectedPoint === null) return;
    const snapshot = snapshotProfile();
    const point = state.profile[selectedPoint];
    const last = state.profile.length - 1;
    if (axis === "r") {
      const next = point.r + amount;
      if (next > editorView.maxR) {
        showToast("Extend the X axis before moving farther right.");
        return;
      }
      point.r = Math.max(1, next);
    } else {
      const minimum = selectedPoint === 0 ? 0 : state.profile[selectedPoint - 1].z + 1;
      const maximum = selectedPoint === last ? editorView.maxZ : state.profile[selectedPoint + 1].z - 1;
      const next = point.z + amount;
      if (next > editorView.maxZ) {
        showToast("Extend the Y axis before moving higher.");
        return;
      }
      point.z = selectedPoint === 0 ? 0 : Math.max(minimum, Math.min(maximum, next));
    }
    if (JSON.stringify(snapshot) !== JSON.stringify(state.profile)) recordHistory(snapshot);
    refreshAll();
  }

  function drawProfileGrid(ctx, map) {
    const major = map.maxZ > 280 ? 50 : 20;
    ctx.save();
    ctx.font = "10px Avenir Next, sans-serif";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(85, 69, 55, 0.11)";
    ctx.fillStyle = "rgba(85, 69, 55, 0.58)";
    ctx.lineWidth = 1;
    for (let z = 0; z <= map.maxZ + 0.01; z += major) {
      const y = map.toCanvas({ z, r: 0 }).y;
      ctx.beginPath();
      ctx.moveTo(map.pad.left, y);
      ctx.lineTo(map.width - map.pad.right, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round(z)), map.pad.left - 8, y);
    }
    const radiusStep = map.maxR > 140 ? 50 : 20;
    for (let r = 0; r <= map.maxR; r += radiusStep) {
      const x = map.toCanvas({ z: 0, r }).x;
      ctx.beginPath();
      ctx.moveTo(x, map.pad.top);
      ctx.lineTo(x, map.height - map.pad.bottom);
      ctx.stroke();
      if (r > 0) {
        ctx.textAlign = "center";
        ctx.fillText(String(Math.round(r)), x, map.height - map.pad.bottom + 18);
      }
    }
    ctx.strokeStyle = "rgba(65, 48, 38, 0.42)";
    ctx.beginPath();
    ctx.moveTo(map.pad.left, map.pad.top);
    ctx.lineTo(map.pad.left, map.height - map.pad.bottom);
    ctx.stroke();
    ctx.restore();
  }

  function nearestPoint(x, y) {
    const map = profileMap();
    let winner = null;
    let distance = 16;
    state.profile.forEach((point, index) => {
      const screen = map.toCanvas(point);
      const nextDistance = Math.hypot(screen.x - x, screen.y - y);
      if (nextDistance < distance) { winner = index; distance = nextDistance; }
    });
    return winner;
  }

  function profilePointer(event) {
    const rect = elements.profileCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function beginProfilePointer(event) {
    if (event.button !== 0) return;
    const pointer = profilePointer(event);
    const hit = nearestPoint(pointer.x, pointer.y);
    if (hit !== null) {
      selectedPoint = hit;
      draggingPoint = hit;
      dragSnapshot = snapshotProfile();
      elements.profileCanvas.setPointerCapture(event.pointerId);
      elements.profileCanvas.classList.add("is-dragging");
      drawProfileEditor();
      return;
    }
    const map = profileMap();
    const point = map.toProfile(pointer.x, pointer.y);
    if (point.z < 1 || point.z > map.maxZ - 1) return;
    recordHistory();
    state.profile.push(point);
    state.profile = geometry.normalizeProfile(state.profile);
    selectedPoint = state.profile.findIndex((candidate) => Math.abs(candidate.z - point.z) < 0.11);
    refreshAll();
  }

  function moveProfilePointer(event) {
    if (draggingPoint === null) return;
    const pointer = profilePointer(event);
    const map = profileMap();
    const point = map.toProfile(pointer.x, pointer.y);
    const last = state.profile.length - 1;
    if (draggingPoint === 0) point.z = 0;
    else if (draggingPoint === last) point.z = Math.max(state.profile[last - 1].z + 2, point.z);
    else {
      point.z = Math.max(state.profile[draggingPoint - 1].z + 2, Math.min(state.profile[draggingPoint + 1].z - 2, point.z));
    }
    state.profile[draggingPoint] = point;
    refreshAll({ keepDimensions: false });
  }

  function endProfilePointer(event) {
    if (draggingPoint === null) return;
    elements.profileCanvas.releasePointerCapture?.(event.pointerId);
    elements.profileCanvas.classList.remove("is-dragging");
    if (dragSnapshot && JSON.stringify(dragSnapshot) !== JSON.stringify(state.profile)) recordHistory(dragSnapshot);
    draggingPoint = null;
    dragSnapshot = null;
  }

  function ensureEditorViewFitsProfile() {
    const required = initialEditorView(state.profile);
    editorView.maxR = Math.max(editorView.maxR, required.maxR);
    editorView.maxZ = Math.max(editorView.maxZ, required.maxZ);
  }

  function removePoint(event) {
    const pointer = profilePointer(event);
    const hit = nearestPoint(pointer.x, pointer.y);
    if (hit === null || hit === 0 || hit === state.profile.length - 1 || state.profile.length <= 3) return;
    recordHistory();
    state.profile.splice(hit, 1);
    selectedPoint = null;
    refreshAll();
  }

  // WebGL preview ----------------------------------------------------------

  const renderer = createRenderer(elements.glCanvas);
  let cameraYaw = 0.55;
  let cameraPitch = 0.3;
  let cameraZoom = 2.35;
  let orbitPointer = null;

  function createRenderer(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true }) || canvas.getContext("experimental-webgl", { antialias: true, alpha: true });
    if (!gl) {
      showToast("3D preview needs WebGL. Profile editing and STL export still work.");
      return null;
    }
    const vertexSource = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      uniform mat4 uModel;
      uniform mat4 uMvp;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec4 world = uModel * vec4(aPosition, 1.0);
        vWorld = world.xyz;
        vNormal = mat3(uModel) * aNormal;
        gl_Position = uMvp * vec4(aPosition, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec3 vNormal;
      varying vec3 vWorld;
      uniform vec3 uClay;
      uniform float uHeight;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 light = normalize(vec3(-0.42, 0.78, 0.58));
        float diffuse = max(dot(n, light), 0.0);
        float rim = pow(1.0 - max(dot(n, normalize(vec3(0.0, 0.1, 1.0))), 0.0), 2.4);
        float vertical = clamp(vWorld.y / max(uHeight, 1.0), 0.0, 1.0);
        vec3 base = uClay * (0.90 + vertical * 0.08);
        vec3 color = base * (0.48 + diffuse * 0.58) + vec3(0.22, 0.13, 0.08) * rim * 0.11;
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const program = createProgram(gl, vertexSource, fragmentSource);
    return {
      gl,
      program,
      attributes: {
        position: gl.getAttribLocation(program, "aPosition"),
        normal: gl.getAttribLocation(program, "aNormal")
      },
      uniforms: {
        model: gl.getUniformLocation(program, "uModel"),
        mvp: gl.getUniformLocation(program, "uMvp"),
        clay: gl.getUniformLocation(program, "uClay"),
        height: gl.getUniformLocation(program, "uHeight")
      },
      positionBuffer: gl.createBuffer(),
      normalBuffer: gl.createBuffer(),
      indexBuffer: gl.createBuffer(),
      indexCount: 0,
      indexType: gl.UNSIGNED_SHORT
    };
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  function rebuildMesh() {
    const scale = viewMode === "former" ? geometry.shrinkageScale(state.shrinkage) : 1;
    currentMesh = viewMode === "former"
      ? geometry.buildSolidMesh(state.profile, { radialSegments: 96, samplesPerSegment: 22, scale })
      : geometry.buildVesselMesh(state.profile, { radialSegments: 96, samplesPerSegment: 22, wall: state.wall, base: state.base });
    if (!renderer) return;
    const { gl } = renderer;
    const vertexCount = currentMesh.positions.length / 3;
    const useUint32 = vertexCount > 65535;
    if (useUint32 && !gl.getExtension("OES_element_index_uint")) {
      showToast("This profile is too detailed for the current 3D renderer.");
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentMesh.positions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentMesh.normals), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, useUint32 ? new Uint32Array(currentMesh.indices) : new Uint16Array(currentMesh.indices), gl.DYNAMIC_DRAW);
    renderer.indexType = useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    renderer.indexCount = currentMesh.indices.length;
  }

  function render(time) {
    if (autoSpin) wheelAngle += 0.00018 * Math.min(32, time - (render.lastTime || time));
    render.lastTime = time;
    if (renderer && currentMesh) drawMesh();
    requestAnimationFrame(render);
  }

  function drawMesh() {
    const { gl, program, attributes, uniforms } = renderer;
    const { width, height } = sizeCanvas(elements.glCanvas);
    gl.viewport(0, 0, elements.glCanvas.width, elements.glCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(program);

    const bounds = currentMesh.bounds;
    const objectHeight = bounds.size[1];
    const objectDiameter = Math.max(bounds.size[0], bounds.size[2]);
    const radius = Math.max(objectHeight, objectDiameter) * cameraZoom;
    const target = [0, objectHeight * 0.48, 0];
    const yaw = cameraYaw;
    const pitch = cameraPitch;
    const eye = [
      Math.sin(yaw) * Math.cos(pitch) * radius,
      target[1] + Math.sin(pitch) * radius,
      Math.cos(yaw) * Math.cos(pitch) * radius
    ];
    const projection = perspective(Math.PI / 4.5, width / Math.max(1, height), Math.max(0.1, radius / 100), radius * 10);
    const view = lookAt(eye, target, [0, 1, 0]);
    const model = rotationY(wheelAngle);
    const mvp = multiply4(projection, multiply4(view, model));

    gl.uniformMatrix4fv(uniforms.model, false, model);
    gl.uniformMatrix4fv(uniforms.mvp, false, mvp);
    gl.uniform3f(uniforms.clay, 0.61, 0.29, 0.18);
    gl.uniform1f(uniforms.height, objectHeight);

    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.positionBuffer);
    gl.enableVertexAttribArray(attributes.position);
    gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.normalBuffer);
    gl.enableVertexAttribArray(attributes.normal);
    gl.vertexAttribPointer(attributes.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.indexBuffer);
    gl.drawElements(gl.TRIANGLES, renderer.indexCount, renderer.indexType, 0);
  }

  function drawStageOverlay() {
    const { width, height, dpr } = sizeCanvas(elements.overlayCanvas);
    const ctx = elements.overlayCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const centerX = width / 2;
    const centerY = height * 0.82;
    const maxWidth = Math.min(width * 0.66, height * 0.5);
    if (state.wheel.shown) {
      ctx.fillStyle = "rgba(58, 49, 43, 0.58)";
      ctx.font = "600 10px Avenir Next, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Ø ${Math.round(state.wheel.diameter)} MM WHEEL HEAD`, centerX, Math.min(height - 18, centerY + maxWidth * 0.22 + 24));
      return;
    }
    ctx.strokeStyle = "rgba(76, 53, 41, 0.14)";
    ctx.lineWidth = 1;
    [1, 0.76, 0.52].forEach((scale) => {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, maxWidth * scale, maxWidth * scale * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(centerX, height * 0.13);
    ctx.lineTo(centerX, centerY);
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = "rgba(76, 53, 41, 0.1)";
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawWheelUnderlay() {
    const { width, height, dpr } = sizeCanvas(elements.wheelCanvas);
    const ctx = elements.wheelCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    updateWheelVisual();
  }

  function updateWheelVisual() {
    elements.wheelVisual.hidden = !state.wheel.shown;
    if (!state.wheel.shown) return;
    const analysis = geometry.analyzeProfile(state.profile);
    const displayedDiameter = analysis.diameter * (viewMode === "former" ? geometry.shrinkageScale(state.shrinkage) : 1);
    const widthPercent = Math.max(34, Math.min(90, 46 * state.wheel.diameter / Math.max(1, displayedDiameter)));
    elements.wheelVisual.style.width = `${widthPercent}%`;
  }

  function paintMetalWheel(ctx, width, height) {
    const analysis = geometry.analyzeProfile(state.profile);
    const displayedDiameter = analysis.diameter * (viewMode === "former" ? geometry.shrinkageScale(state.shrinkage) : 1);
    const formPixels = Math.min(width * 0.42, height * 0.35);
    const wheelPixels = Math.max(formPixels * 1.1, Math.min(width * 0.88, formPixels * state.wheel.diameter / Math.max(1, displayedDiameter)));
    const rx = wheelPixels / 2;
    const ry = Math.max(13, rx * 0.16);
    const centerX = width / 2;
    const centerY = height * 0.82;

    const pedestal = ctx.createLinearGradient(centerX - rx * 0.32, 0, centerX + rx * 0.32, 0);
    pedestal.addColorStop(0, "rgba(67, 68, 66, 0.48)");
    pedestal.addColorStop(0.42, "rgba(185, 184, 176, 0.62)");
    pedestal.addColorStop(0.62, "rgba(94, 96, 93, 0.58)");
    pedestal.addColorStop(1, "rgba(48, 50, 49, 0.45)");
    ctx.fillStyle = pedestal;
    ctx.beginPath();
    ctx.moveTo(centerX - rx * 0.31, centerY + ry * 0.25);
    ctx.lineTo(centerX + rx * 0.31, centerY + ry * 0.25);
    ctx.lineTo(centerX + rx * 0.22, centerY + ry * 2.35);
    ctx.lineTo(centerX - rx * 0.22, centerY + ry * 2.35);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(45, 47, 46, 0.5)";
    ctx.beginPath();
    ctx.ellipse(centerX, centerY + ry * 0.65, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    const metal = ctx.createRadialGradient(centerX - rx * 0.24, centerY - ry * 0.35, 4, centerX, centerY, rx);
    metal.addColorStop(0, "rgba(239, 237, 226, 0.92)");
    metal.addColorStop(0.34, "rgba(173, 174, 169, 0.88)");
    metal.addColorStop(0.72, "rgba(112, 115, 112, 0.92)");
    metal.addColorStop(1, "rgba(66, 69, 68, 0.95)");
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 242, 231, 0.58)";
    ctx.lineWidth = 1;
    [0.72, 0.45, 0.18].forEach((scale) => {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, rx * scale, ry * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length; zy /= length; zz /= length;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length; xy /= length; xz /= length;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  }

  function rotationY(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function multiply4(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[0 * 4 + row] * b[column * 4 + 0] +
          a[1 * 4 + row] * b[column * 4 + 1] +
          a[2 * 4 + row] * b[column * 4 + 2] +
          a[3 * 4 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  // Events and exports -----------------------------------------------------

  function bindEvents() {
    elements.undo.addEventListener("click", undo);
    elements.redo.addEventListener("click", redo);
    elements.profileCanvas.addEventListener("pointerdown", beginProfilePointer);
    elements.profileCanvas.addEventListener("pointermove", moveProfilePointer);
    elements.profileCanvas.addEventListener("pointerup", endProfilePointer);
    elements.profileCanvas.addEventListener("pointercancel", endProfilePointer);
    elements.profileCanvas.addEventListener("dblclick", removePoint);
    elements.profileCanvas.addEventListener("keydown", profileKeydown);
    let resizeFrame = 0;
    window.addEventListener("resize", () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        drawProfileEditor();
        drawWheelUnderlay();
        drawStageOverlay();
      });
    });
    elements.extendX.addEventListener("click", () => extendAxis("x"));
    elements.extendY.addEventListener("click", () => extendAxis("y"));
    elements.pointNudger.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.nudgeR) nudgeSelected("r", Number(button.dataset.nudgeR));
      if (button.dataset.nudgeZ) nudgeSelected("z", Number(button.dataset.nudgeZ));
    });

    $$(".preset").forEach((button) => button.addEventListener("click", () => {
      recordHistory();
      state.profile = geometry.cloneProfile(geometry.PRESETS[button.dataset.preset]);
      editorView = initialEditorView(state.profile);
      selectedPoint = null;
      refreshAll();
    }));

    $$(".view-option[data-view]").forEach((button) => button.addEventListener("click", () => {
      viewMode = button.dataset.view;
      $$(".view-option[data-view]").forEach((option) => option.classList.toggle("is-active", option === button));
      refreshAll();
    }));

    bindDimension(elements.height, "height");
    bindDimension(elements.diameter, "diameter");
    bindSetting(elements.shrinkage, "shrinkage", 0, 30);
    bindSetting(elements.wall, "wall", 0.5, 20);
    bindSetting(elements.base, "base", 1, 30);
    bindPlate(elements.plateWidth, "width");
    bindPlate(elements.plateDepth, "depth");
    bindPlate(elements.plateHeight, "height");

    elements.designName.addEventListener("input", () => { state.name = elements.designName.value || DEFAULTS.name; scheduleSave(); });
    elements.reset.addEventListener("click", resetDesign);
    elements.spin.addEventListener("click", () => {
      autoSpin = !autoSpin;
      elements.spin.classList.toggle("is-on", autoSpin);
      elements.spin.setAttribute("aria-pressed", String(autoSpin));
      elements.spin.lastChild.textContent = autoSpin ? " Wheel turning" : " Wheel paused";
    });
    elements.showWheel.addEventListener("change", () => {
      state.wheel.shown = elements.showWheel.checked;
      elements.wheelSizeField.hidden = !state.wheel.shown;
      drawWheelUnderlay();
      drawStageOverlay();
      scheduleSave();
    });
    elements.wheelDiameter.addEventListener("input", () => {
      state.wheel.diameter = Math.max(120, Math.min(800, validNumber(elements.wheelDiameter.value, state.wheel.diameter)));
      drawWheelUnderlay();
      drawStageOverlay();
      scheduleSave();
    });

    elements.stageWrap.addEventListener("pointerdown", beginOrbit);
    elements.stageWrap.addEventListener("pointermove", moveOrbit);
    elements.stageWrap.addEventListener("pointerup", endOrbit);
    elements.stageWrap.addEventListener("pointercancel", endOrbit);
    elements.stageWrap.addEventListener("wheel", (event) => {
      event.preventDefault();
      cameraZoom = Math.max(1.25, Math.min(4.2, cameraZoom * Math.exp(event.deltaY * 0.001)));
    }, { passive: false });

    elements.exportFormer.addEventListener("click", exportFormer);
    elements.exportVessel.addEventListener("click", exportVessel);
    elements.exportProfile.addEventListener("click", exportProfile);
    elements.exportSvg.addEventListener("click", exportSvg);
    elements.importProfile.addEventListener("change", importProfile);
  }

  function bindSetting(input, key, min, max) {
    input.addEventListener("input", () => {
      const value = Math.max(min, Math.min(max, validNumber(input.value, state[key])));
      state[key] = value;
      refreshAll({ keepDimensions: true });
    });
  }

  function bindPlate(input, key) {
    input.addEventListener("input", () => {
      state.plate[key] = Math.max(50, validNumber(input.value, state.plate[key]));
      refreshAll({ keepDimensions: true });
    });
  }

  function bindDimension(input, changed) {
    input.addEventListener("focus", () => {
      if (!dimensionSnapshot) dimensionSnapshot = snapshotProfile();
    });
    input.addEventListener("input", () => {
      if (!dimensionSnapshot) dimensionSnapshot = snapshotProfile();
      resizeFromInputs(changed);
      window.clearTimeout(dimensionTimer);
      dimensionTimer = window.setTimeout(commitDimensionEdit, 450);
    });
    input.addEventListener("blur", commitDimensionEdit);
  }

  function commitDimensionEdit() {
    window.clearTimeout(dimensionTimer);
    if (!dimensionSnapshot) return;
    if (JSON.stringify(dimensionSnapshot) !== JSON.stringify(state.profile)) recordHistory(dimensionSnapshot);
    dimensionSnapshot = null;
  }

  function resizeFromInputs(changed) {
    const analysis = geometry.analyzeProfile(state.profile);
    const height = changed === "height" ? Math.max(30, validNumber(elements.height.value, analysis.height)) : analysis.height;
    const diameter = changed === "diameter" ? Math.max(20, validNumber(elements.diameter.value, analysis.diameter)) : analysis.diameter;
    state.profile = geometry.resizeProfile(state.profile, height, diameter);
    ensureEditorViewFitsProfile();
    refreshAll();
  }

  function profileKeydown(event) {
    if (selectedPoint === null) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selectedPoint > 0 && selectedPoint < state.profile.length - 1 && state.profile.length > 3) {
      event.preventDefault();
      recordHistory();
      state.profile.splice(selectedPoint, 1);
      selectedPoint = null;
      refreshAll();
      return;
    }
    const delta = event.shiftKey ? 5 : 1;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    recordHistory();
    const point = state.profile[selectedPoint];
    if (event.key === "ArrowLeft") point.r = Math.max(1, point.r - delta);
    if (event.key === "ArrowRight") point.r += delta;
    if (event.key === "ArrowUp" && selectedPoint < state.profile.length - 1) point.z = Math.min(state.profile[selectedPoint + 1].z - 1, point.z + delta);
    if (event.key === "ArrowDown" && selectedPoint > 0) point.z = Math.max(state.profile[selectedPoint - 1].z + 1, point.z - delta);
    refreshAll();
  }

  function beginOrbit(event) {
    if (event.target.closest("button, input, label")) return;
    orbitPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: cameraYaw, pitch: cameraPitch };
    elements.stageWrap.setPointerCapture(event.pointerId);
    elements.stageWrap.classList.add("is-dragging");
  }

  function moveOrbit(event) {
    if (!orbitPointer || orbitPointer.id !== event.pointerId) return;
    cameraYaw = orbitPointer.yaw - (event.clientX - orbitPointer.x) * 0.008;
    cameraPitch = Math.max(-0.42, Math.min(0.55, orbitPointer.pitch + (event.clientY - orbitPointer.y) * 0.006));
  }

  function endOrbit(event) {
    if (!orbitPointer || orbitPointer.id !== event.pointerId) return;
    elements.stageWrap.releasePointerCapture?.(event.pointerId);
    elements.stageWrap.classList.remove("is-dragging");
    orbitPointer = null;
  }

  function resetDesign() {
    recordHistory();
    state = structuredClone(DEFAULTS);
    editorView = initialEditorView(state.profile);
    selectedPoint = null;
    valuesFromState();
    refreshAll();
    showToast("A fresh bowl profile is ready.");
  }

  function exportFormer() {
    try {
      elements.exportFormer.disabled = true;
      const scale = geometry.shrinkageScale(state.shrinkage);
      const mesh = geometry.buildSolidMesh(state.profile, { radialSegments: 160, samplesPerSegment: 34, scale });
      const stl = geometry.binaryStl(mesh, `${slugify(state.name)}-former`);
      download(stl, `${slugify(state.name)}-former-${state.shrinkage.toFixed(1)}pct.stl`, "model/stl");
      showToast("Former STL downloaded with shrinkage compensation.");
    } catch (error) {
      showToast(`Former export failed: ${error.message}`);
    } finally {
      elements.exportFormer.disabled = false;
    }
  }

  function exportVessel() {
    try {
      elements.exportVessel.disabled = true;
      const mesh = geometry.buildVesselMesh(state.profile, { radialSegments: 160, samplesPerSegment: 34, wall: state.wall, base: state.base });
      const stl = geometry.binaryStl(mesh, `${slugify(state.name)}-vessel`);
      download(stl, `${slugify(state.name)}-vessel.stl`, "model/stl");
      showToast("Hollow vessel STL downloaded at final dimensions.");
    } catch (error) {
      showToast(`Vessel export failed: ${error.message}`);
    } finally {
      elements.exportVessel.disabled = false;
    }
  }

  function exportProfile() {
    const payload = {
      format: "formwheel-profile",
      version: 1,
      units: "mm",
      name: state.name,
      profile: state.profile,
      shrinkage: state.shrinkage,
      wall: state.wall,
      base: state.base,
      plate: state.plate
    };
    download(JSON.stringify(payload, null, 2), `${slugify(state.name)}.formwheel.json`, "application/json");
    showToast("Editable profile downloaded.");
  }

  function exportSvg() {
    download(geometry.profileSvg(state.profile), `${slugify(state.name)}-profile.svg`, "image/svg+xml");
    showToast("Profile SVG downloaded at real millimeter scale.");
  }

  async function importProfile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const profile = geometry.normalizeProfile(payload.profile);
      recordHistory();
      state.profile = profile;
      editorView = initialEditorView(state.profile);
      state.name = typeof payload.name === "string" ? payload.name : state.name;
      state.shrinkage = validNumber(payload.shrinkage, state.shrinkage);
      state.wall = validNumber(payload.wall, state.wall);
      state.base = validNumber(payload.base, state.base);
      if (payload.plate) state.plate = { ...state.plate, ...payload.plate };
      valuesFromState();
      refreshAll();
      showToast("Profile opened.");
    } catch (error) {
      showToast(`That profile could not be opened: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  window.FormwheelApp = {
    getCurrentDesign() {
      const analysis = geometry.analyzeProfile(state.profile, { wall: state.wall, base: state.base });
      return {
        name: state.name,
        profile: geometry.cloneProfile(state.profile),
        shrinkage: state.shrinkage,
        shrinkageScale: geometry.shrinkageScale(state.shrinkage),
        analysis,
        plate: { ...state.plate }
      };
    },
    getCurrentFormerMesh(options = {}) {
      return geometry.buildFormerMesh(state.profile, {
        radialSegments: options.radialSegments || 128,
        samplesPerSegment: options.samplesPerSegment || 28,
        scale: geometry.shrinkageScale(state.shrinkage),
        slipWellHeight: options.slipWellHeight || 26,
        slipWellFlare: options.slipWellFlare || 10
      });
    },
    refreshViewport() {
      drawProfileEditor();
      drawWheelUnderlay();
      drawStageOverlay();
    },
    showToast
  };

  valuesFromState();
  bindEvents();
  elements.spin.classList.toggle("is-on", autoSpin);
  elements.spin.setAttribute("aria-pressed", String(autoSpin));
  updateHistoryButtons();
  refreshAll();
  requestAnimationFrame(render);
})();
