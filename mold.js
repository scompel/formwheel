(function formwheelMoldMode() {
  "use strict";

  const geometry = window.FormwheelGeometry;
  const moldGeometry = window.FormwheelMoldGeometry;
  const app = window.FormwheelApp;
  if (!geometry || !moldGeometry || !app) return;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const elements = {
    formWorkspace: $("#workspace"),
    moldWorkspace: $("#mold-workspace"),
    sourceCurrent: $("#source-current"),
    stlDrop: $("#stl-drop"),
    stlInput: $("#mold-stl-input"),
    sourceName: $("#mold-source-name"),
    sourceSize: $("#source-size"),
    sourceTriangles: $("#source-triangles"),
    sourceCompensation: $("#source-compensation"),
    uploadShrinkageField: $("#upload-shrinkage-field"),
    uploadShrinkage: $("#upload-shrinkage"),
    sourceGuidance: $("#source-guidance"),
    copyCurrent: $("#copy-current-form"),
    canvas: $("#mold-canvas"),
    overlay: $("#mold-overlay"),
    stage: $(".mold-stage-wrap"),
    empty: $("#mold-empty"),
    plasterWall: $("#plaster-wall"),
    plasterBase: $("#plaster-base"),
    caseWall: $("#case-wall"),
    baseThickness: $("#mold-base-thickness"),
    outerSize: $("#mold-outer-size"),
    plasterVolume: $("#plaster-volume"),
    largestPart: $("#largest-part"),
    printFit: $("#mold-print-fit"),
    kitStatus: $("#kit-status"),
    formerPartSize: $("#former-part-size"),
    leftPartSize: $("#left-part-size"),
    rightPartSize: $("#right-part-size"),
    basePartSize: $("#base-part-size"),
    natchPart: $("#natch-part"),
    natchPartSize: $("#natch-part-size"),
    downloadFormer: $("#download-kit-former"),
    downloadLeft: $("#download-case-left"),
    downloadRight: $("#download-case-right"),
    downloadBase: $("#download-mold-base"),
    downloadNatches: $("#download-natches"),
    downloadSheet: $("#download-build-sheet"),
    castingSteps: $("#casting-steps")
  };

  const state = {
    sourceType: "current",
    sourceName: "Untitled vessel",
    sourceMesh: null,
    uploadedMesh: null,
    sourceTriangles: 0,
    sourceCompensation: "—",
    method: "single",
    view: "assembled",
    openingRadius: null,
    kit: null,
    settings: {
      plasterWall: 25,
      plasterBase: 25,
      caseWall: 2.4,
      baseThickness: 4,
      splitGap: 0.6
    },
    plate: { width: 256, depth: 256, height: 256 }
  };

  const renderer = createMoldRenderer(elements.canvas);

  function cloneSourceWithUploadScale() {
    if (!state.sourceMesh) return null;
    if (state.sourceType !== "upload") return moldGeometry.cloneMesh(state.sourceMesh);
    return moldGeometry.transformMesh(state.sourceMesh, {
      scale: geometry.shrinkageScale(Number(elements.uploadShrinkage.value) || 0),
      centerX: true,
      centerZ: true
    });
  }

  function refreshFromCurrent(announce = false) {
    const design = app.getCurrentDesign();
    state.sourceType = "current";
    state.sourceName = design.name;
    state.sourceMesh = app.getCurrentFormerMesh({ radialSegments: 128, samplesPerSegment: 28 });
    state.openingRadius = design.profile.at(-1).r * design.shrinkageScale + 10;
    state.sourceTriangles = state.sourceMesh.indices.length / 3;
    state.sourceCompensation = `${design.shrinkage.toFixed(1)}% · ${design.shrinkageScale.toFixed(3)}×`;
    state.plate = { ...design.plate };
    state.method = design.analysis.hasUndercut ? "split" : "single";
    updateSourceControls();
    rebuildKit();
    if (announce) app.showToast("The current Formwheel former was copied into the mold kit.");
  }

  function selectSource(type) {
    state.sourceType = type;
    $$(".source-option").forEach((button) => button.classList.toggle("is-active", button.dataset.source === type));
    elements.sourceCurrent.hidden = type !== "current";
    elements.stlDrop.hidden = type !== "upload";
    elements.uploadShrinkageField.hidden = type !== "upload";
    if (type === "current") {
      refreshFromCurrent();
      return;
    }
    state.sourceMesh = state.uploadedMesh;
    state.method = "split";
    state.sourceCompensation = `${Number(elements.uploadShrinkage.value || 0).toFixed(1)}% added`;
    updateSourceControls();
    rebuildKit();
  }

  async function loadStl(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      app.showToast("That STL is larger than 50 MB. Simplify it before mold generation.");
      return;
    }
    try {
      elements.stlDrop.classList.add("is-loading");
      const mesh = moldGeometry.parseStl(await file.arrayBuffer());
      state.uploadedMesh = mesh;
      state.sourceMesh = mesh;
      state.sourceName = file.name.replace(/\.stl$/i, "") || "uploaded-form";
      state.openingRadius = mesh.bounds.size[0] * 0.28;
      state.sourceTriangles = mesh.triangleCount || mesh.indices.length / 3;
      state.sourceCompensation = `${Number(elements.uploadShrinkage.value || 0).toFixed(1)}% added`;
      state.method = "split";
      updateSourceControls();
      rebuildKit();
      app.showToast(`${file.name} is ready for mold tooling.`);
    } catch (error) {
      state.sourceMesh = null;
      state.uploadedMesh = null;
      rebuildKit();
      app.showToast(`That STL could not be used: ${error.message}`);
    } finally {
      elements.stlDrop.classList.remove("is-loading", "is-dragover");
      elements.stlInput.value = "";
    }
  }

  function updateSourceControls() {
    elements.sourceName.textContent = state.sourceName;
    const working = cloneSourceWithUploadScale();
    if (working) {
      elements.sourceSize.textContent = formatSize(moldGeometry.stlSize(working));
      elements.sourceTriangles.textContent = Math.round(state.sourceTriangles).toLocaleString();
      elements.sourceCompensation.textContent = state.sourceCompensation;
    } else {
      elements.sourceSize.textContent = "No STL loaded";
      elements.sourceTriangles.textContent = "—";
      elements.sourceCompensation.textContent = state.sourceCompensation;
    }
    $$(".method-option").forEach((button) => button.classList.toggle("is-active", button.dataset.method === state.method));
    updateGuidance();
  }

  function updateGuidance() {
    if (state.method === "split") {
      elements.sourceGuidance.innerHTML = `
        <span class="status-mark" aria-hidden="true">Ⅱ</span>
        <div><strong>Plan two plaster pours</strong><p>Split at the widest horizontal plane. Four rounded natches make the cured plaster halves locate cleanly.</p></div>`;
      elements.castingSteps.innerHTML = `
        <li>Print and finish the inner former; seal the casting surface and fit the gasketed case.</li>
        <li>Build a level clay bed at the indicated widest plane and press the four natches halfway into it.</li>
        <li>Pour the first plaster half. Remove the clay and natches, soap the plaster face, then pour the second half so it forms matching bumps.</li>
        <li>Open the keyed plaster halves, remove the former, dry thoroughly, then reassemble for slip casting.</li>`;
    } else {
      elements.sourceGuidance.innerHTML = `
        <span class="status-mark" aria-hidden="true">↓</span>
        <div><strong>One plaster pour</strong><p>The former’s slip well seats in the bottom ring while the close-fitting case controls the plaster wall.</p></div>`;
      elements.castingSteps.innerHTML = `
        <li>Print and finish the inner former; filler-prime and seal every layer line that touches plaster.</li>
        <li>Seat the slip well in the bottom ring. Add gasket cord, close the guided case halves, and clamp the flanges.</li>
        <li>Apply the tested release system, pour pottery plaster, and let it set completely.</li>
        <li>Open the case, remove the former, dry the plaster thoroughly, then slip cast through the well.</li>`;
    }
    elements.natchPart.hidden = state.method !== "split";
  }

  function rebuildKit() {
    const source = cloneSourceWithUploadScale();
    if (!source) {
      state.kit = null;
      elements.empty.hidden = false;
      renderer.setMesh(null);
      updateKitReadout();
      drawOverlay();
      return;
    }
    state.settings = {
      plasterWall: Number(elements.plasterWall.value) || 25,
      plasterBase: Number(elements.plasterBase.value) || 25,
      caseWall: Number(elements.caseWall.value) || 2.4,
      baseThickness: Number(elements.baseThickness.value) || 4,
      openingRadius: state.openingRadius,
      flangeDepth: 8,
      flangeWidth: 14,
      guideRail: 1.8,
      natchRadius: 6
    };
    state.kit = moldGeometry.buildKit(source, state.settings);
    elements.empty.hidden = true;
    renderer.setMesh(buildPreviewMesh());
    updateKitReadout();
    drawOverlay();
  }

  function buildPreviewMesh() {
    const kit = state.kit;
    const invertedFormer = moldGeometry.transformMesh(kit.parts.former, {
      flipY: true,
      centerX: true,
      centerZ: true,
      translate: [0, kit.baseThickness, 0]
    });
    const spread = state.view === "exploded" ? kit.outerWidth * 0.34 : 0;
    const formerDepthShift = state.view === "exploded" ? kit.outerDepth * 0.46 : 0;
    const baseDrop = state.view === "exploded" ? -kit.baseThickness * 4 : 0;
    const previewParts = [
      { mesh: kit.parts.base, color: [0.31, 0.27, 0.23], translate: [0, baseDrop, 0] },
      { mesh: kit.parts.left, color: [0.83, 0.76, 0.63], translate: [-spread, kit.baseThickness, 0] },
      { mesh: invertedFormer, color: [0.62, 0.29, 0.18], translate: [0, 0, formerDepthShift] }
    ];
    if (state.view === "exploded") previewParts.splice(2, 0, { mesh: kit.parts.right, color: [0.76, 0.69, 0.57], translate: [spread, kit.baseThickness, 0] });
    if (state.method === "split") {
      const invertedParting = kit.sourceBounds.size[1] - kit.partingHeight;
      previewParts.push({
        mesh: kit.parts.natches,
        color: [0.77, 0.55, 0.18],
        translate: [0, kit.baseThickness + invertedParting - kit.natchRadius, formerDepthShift * 0.35]
      });
    }
    return moldGeometry.mergeMeshes(previewParts);
  }

  function updateKitReadout() {
    const kit = state.kit;
    const downloadButtons = [elements.downloadFormer, elements.downloadLeft, elements.downloadRight, elements.downloadBase, elements.downloadNatches, elements.downloadSheet];
    if (!kit) {
      elements.outerSize.textContent = "—";
      elements.plasterVolume.textContent = "—";
      elements.largestPart.textContent = "—";
      elements.printFit.textContent = "Waiting";
      [elements.formerPartSize, elements.leftPartSize, elements.rightPartSize, elements.basePartSize].forEach((element) => { element.textContent = "—"; });
      downloadButtons.forEach((button) => { button.disabled = true; });
      elements.kitStatus.classList.add("is-warning");
      elements.kitStatus.innerHTML = `<span class="status-mark" aria-hidden="true">…</span><div><strong>Choose a form</strong><p>Upload an STL or use the current Formwheel form to size the tooling.</p></div>`;
      return;
    }

    downloadButtons.forEach((button) => { button.disabled = false; });
    elements.outerSize.textContent = `Ø ${kit.outerWidth.toFixed(0)} × ${kit.caseHeight.toFixed(0)} mm`;
    elements.plasterVolume.textContent = kit.plasterVolumeMl >= 1000 ? `${(kit.plasterVolumeMl / 1000).toFixed(1)} L` : `${Math.round(kit.plasterVolumeMl)} mL`;
    const entries = Object.entries(kit.partSizes);
    const largest = entries.reduce((winner, entry) => Math.max(...entry[1]) > Math.max(...winner[1]) ? entry : winner);
    elements.largestPart.textContent = titlePart(largest[0]);
    elements.formerPartSize.textContent = formatSize(kit.partSizes.former);
    elements.leftPartSize.textContent = formatSize(kit.partSizes.left);
    elements.rightPartSize.textContent = formatSize(kit.partSizes.right);
    elements.basePartSize.textContent = formatSize(kit.partSizes.base);
    elements.natchPartSize.textContent = `${formatSize(kit.partSizes.natches)} · four Ø ${(kit.natchRadius * 2).toFixed(0)} mm natches`;

    const failed = entries.filter(([, size]) => !moldGeometry.fitsAnyOrientation(size, state.plate)).map(([name]) => titlePart(name));
    const fits = failed.length === 0;
    elements.printFit.textContent = fits ? "All fit" : `${failed.length} too large`;
    elements.printFit.style.color = fits ? "var(--sage-600)" : "var(--error-600)";
    elements.kitStatus.classList.toggle("is-warning", !fits);
    elements.kitStatus.innerHTML = fits
      ? `<span class="status-mark" aria-hidden="true">✓</span><div><strong>Case system ready</strong><p>Guided case seams, clamp flanges, bottom ring, slip well, and four plaster-registration natches fit the ${state.plate.width} × ${state.plate.depth} × ${state.plate.height} mm printer volume.</p></div>`
      : `<span class="status-mark" aria-hidden="true">!</span><div><strong>Split a large part</strong><p>${failed.join(", ")} will not fit the current printer volume. Reduce the plaster envelope or split the STL in your slicer.</p></div>`;
  }

  function formatSize(size) {
    return size.map((value) => value.toFixed(value >= 100 ? 0 : 1)).join(" × ") + " mm";
  }

  function titlePart(name) {
    return ({ former: "Inner former", left: "Left case", right: "Right case", base: "Bottom ring", natches: "Registration natches" })[name] || name;
  }

  function fileSlug(value) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mold-kit";
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

  function downloadPart(key) {
    if (!state.kit) return;
    const filenames = { former: "inner-former", left: "case-left", right: "case-right", base: "bottom-ring", natches: "registration-natches" };
    const buffer = geometry.binaryStl(state.kit.parts[key], `${fileSlug(state.sourceName)}-${filenames[key]}`);
    download(buffer, `${fileSlug(state.sourceName)}-${filenames[key]}.stl`, "model/stl");
    app.showToast(`${titlePart(key)} STL downloaded in Z-up print coordinates.`);
  }

  function downloadBuildSheet() {
    if (!state.kit) return;
    const kit = state.kit;
    const methodName = state.method === "split" ? "Two-part plaster mold with a horizontal keyed parting plane" : "One-piece upward-pull plaster mold";
    const steps = Array.from(elements.castingSteps.querySelectorAll("li")).map((item, index) => `${index + 1}. ${item.textContent}`).join("\n");
    const sheet = `# ${state.sourceName} — Formwheel mold kit\n\n` +
      `- Units: millimeters\n- Workflow: ${methodName}\n- Inner former: ${formatSize(kit.partSizes.former)}\n- Plaster wall: ${state.settings.plasterWall} mm\n- Plaster base: ${state.settings.plasterBase} mm\n- Case wall: ${state.settings.caseWall} mm\n- Bottom ring: ${state.settings.baseThickness} mm\n- Outer case: Ø ${kit.outerWidth.toFixed(1)} × ${kit.caseHeight.toFixed(1)} mm\n- Case alignment: ${kit.caseGuide}\n- Plaster registration: ${kit.registration} at the widest horizontal plane\n- Estimated plaster volume: ${(kit.plasterVolumeMl / 1000).toFixed(2)} L\n\n` +
      `## Printed parts\n\n- Inner former with slip well: ${formatSize(kit.partSizes.former)}\n- Left case: ${formatSize(kit.partSizes.left)}\n- Right case: ${formatSize(kit.partSizes.right)}\n- Bottom ring: ${formatSize(kit.partSizes.base)}\n- Registration natches: ${formatSize(kit.partSizes.natches)} (split workflow only)\n\n` +
      `## Casting sequence\n\n${steps}\n\n` +
      `## Studio notes\n\nSeal and smooth the printed former before plaster contact. Fit gasket cord in the case seams before clamping. For a split mold, press the rounded natches halfway into the clay bed; the first plaster pour receives sockets and the second pour forms matching bumps. Uploaded STL geometry still requires manual confirmation of its parting surface and slip opening. Test the chosen release system on a scrap print. The plaster estimate is geometric volume, not a manufacturer-specific powder/water recipe.\n`;
    download(sheet, `${fileSlug(state.sourceName)}-mold-build-sheet.md`, "text/markdown");
    app.showToast("Mold build sheet downloaded.");
  }

  function drawOverlay() {
    const canvas = elements.overlay;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!state.kit) return;
    ctx.save();
    ctx.strokeStyle = "rgba(78, 55, 43, 0.22)";
    ctx.fillStyle = "rgba(78, 55, 43, 0.65)";
    ctx.lineWidth = 1;
    ctx.font = "10px Avenir Next, sans-serif";
    ctx.textAlign = "center";
    if (state.method === "split") {
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(rect.width * 0.16, rect.height * 0.5);
      ctx.lineTo(rect.width * 0.84, rect.height * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText("WIDEST PLANE · 4 REGISTRATION NATCHES", rect.width / 2, rect.height * 0.46);
      [0.32, 0.41, 0.59, 0.68].forEach((position) => {
        ctx.beginPath();
        ctx.arc(rect.width * position, rect.height * 0.5, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.beginPath();
    ctx.moveTo(rect.width * 0.12, rect.height * 0.18);
    ctx.lineTo(rect.width * 0.12, rect.height * 0.34);
    ctx.lineTo(rect.width * 0.105, rect.height * 0.31);
    ctx.moveTo(rect.width * 0.12, rect.height * 0.34);
    ctx.lineTo(rect.width * 0.135, rect.height * 0.31);
    ctx.stroke();
    ctx.fillText("POUR", rect.width * 0.12, rect.height * 0.15);
    ctx.restore();
  }

  function bindEvents() {
    $$(".mode-button").forEach((button) => button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      $$(".mode-button").forEach((option) => option.classList.toggle("is-active", option === button));
      elements.formWorkspace.hidden = mode !== "form";
      elements.moldWorkspace.hidden = mode !== "mold";
      document.body.dataset.mode = mode;
      if (mode === "mold" && state.sourceType === "current") refreshFromCurrent();
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      window.setTimeout(() => {
        if (mode === "form") app.refreshViewport();
        else { renderer.resize(); drawOverlay(); }
      }, 80);
    }));

    $$(".source-option").forEach((button) => button.addEventListener("click", () => selectSource(button.dataset.source)));
    elements.copyCurrent.addEventListener("click", () => refreshFromCurrent(true));
    elements.stlInput.addEventListener("change", () => loadStl(elements.stlInput.files?.[0]));
    elements.stlDrop.addEventListener("dragover", (event) => { event.preventDefault(); elements.stlDrop.classList.add("is-dragover"); });
    elements.stlDrop.addEventListener("dragleave", () => elements.stlDrop.classList.remove("is-dragover"));
    elements.stlDrop.addEventListener("drop", (event) => {
      event.preventDefault();
      loadStl(event.dataTransfer?.files?.[0]);
    });
    elements.uploadShrinkage.addEventListener("input", () => {
      state.sourceCompensation = `${Number(elements.uploadShrinkage.value || 0).toFixed(1)}% added`;
      updateSourceControls();
      rebuildKit();
    });

    $$(".method-option").forEach((button) => button.addEventListener("click", () => {
      state.method = button.dataset.method;
      updateSourceControls();
      if (state.kit) renderer.setMesh(buildPreviewMesh());
      updateKitReadout();
      drawOverlay();
    }));
    $$(".mold-view-option").forEach((button) => button.addEventListener("click", () => {
      state.view = button.dataset.moldView;
      $$(".mold-view-option").forEach((option) => option.classList.toggle("is-active", option === button));
      if (state.kit) renderer.setMesh(buildPreviewMesh());
    }));

    [elements.plasterWall, elements.plasterBase, elements.caseWall, elements.baseThickness].forEach((input) => input.addEventListener("input", rebuildKit));
    elements.downloadFormer.addEventListener("click", () => downloadPart("former"));
    elements.downloadLeft.addEventListener("click", () => downloadPart("left"));
    elements.downloadRight.addEventListener("click", () => downloadPart("right"));
    elements.downloadBase.addEventListener("click", () => downloadPart("base"));
    elements.downloadNatches.addEventListener("click", () => downloadPart("natches"));
    elements.downloadSheet.addEventListener("click", downloadBuildSheet);
    window.addEventListener("resize", () => { renderer.resize(); drawOverlay(); });
  }

  // Minimal colored WebGL renderer ---------------------------------------

  function createMoldRenderer(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true }) || canvas.getContext("experimental-webgl", { antialias: true, alpha: true });
    if (!gl) return { setMesh() {}, resize() {} };
    const vertex = `
      attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor;
      uniform mat4 uModel; uniform mat4 uMvp;
      varying vec3 vNormal; varying vec3 vColor; varying vec3 vWorld;
      void main(){ vec4 world=uModel*vec4(aPosition,1.0); vWorld=world.xyz; vNormal=mat3(uModel)*aNormal; vColor=aColor; gl_Position=uMvp*vec4(aPosition,1.0); }
    `;
    const fragment = `
      precision highp float; varying vec3 vNormal; varying vec3 vColor; varying vec3 vWorld;
      void main(){ vec3 n=normalize(vNormal); vec3 light=normalize(vec3(-0.45,0.82,0.55)); float diffuse=max(dot(n,light),0.0); float ambient=0.48; float rim=pow(1.0-max(dot(n,normalize(vec3(0.0,0.15,1.0))),0.0),2.2); vec3 color=vColor*(ambient+diffuse*0.58)+vec3(0.12,0.08,0.05)*rim*0.08; gl_FragColor=vec4(color,1.0); }
    `;
    const program = linkProgram(gl, vertex, fragment);
    const buffers = { position: gl.createBuffer(), normal: gl.createBuffer(), color: gl.createBuffer(), index: gl.createBuffer() };
    const attributes = { position: gl.getAttribLocation(program, "aPosition"), normal: gl.getAttribLocation(program, "aNormal"), color: gl.getAttribLocation(program, "aColor") };
    const uniforms = { model: gl.getUniformLocation(program, "uModel"), mvp: gl.getUniformLocation(program, "uMvp") };
    let mesh = null;
    let indexType = gl.UNSIGNED_SHORT;
    let yaw = 0.68;
    let pitch = 0.4;
    let zoom = 3.05;
    let orbit = null;

    function setMesh(nextMesh) {
      mesh = nextMesh;
      if (!mesh) return;
      const useUint32 = mesh.positions.length / 3 > 65535;
      if (useUint32) gl.getExtension("OES_element_index_uint");
      indexType = useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.colors), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, useUint32 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices), gl.DYNAMIC_DRAW);
    }

    function sizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      return { width: rect.width, height: rect.height };
    }

    function draw() {
      const size = sizeCanvas();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!mesh) { requestAnimationFrame(draw); return; }
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.useProgram(program);
      const bounds = mesh.bounds || moldGeometry.meshBounds(mesh);
      const span = Math.max(...bounds.size);
      const distance = span * zoom;
      const target = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
      const eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * distance, target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(yaw) * Math.cos(pitch) * distance];
      const projection = perspective(Math.PI / 4.5, size.width / Math.max(1, size.height), Math.max(0.1, distance / 100), distance * 10);
      const view = lookAt(eye, target, [0, 1, 0]);
      const model = identity4();
      const mvp = multiply4(projection, multiply4(view, model));
      gl.uniformMatrix4fv(uniforms.model, false, model); gl.uniformMatrix4fv(uniforms.mvp, false, mvp);
      bindAttribute(gl, buffers.position, attributes.position);
      bindAttribute(gl, buffers.normal, attributes.normal);
      bindAttribute(gl, buffers.color, attributes.color);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, indexType, 0);
      requestAnimationFrame(draw);
    }

    elements.stage.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, label")) return;
      orbit = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch };
      elements.stage.setPointerCapture(event.pointerId); elements.stage.classList.add("is-dragging");
    });
    elements.stage.addEventListener("pointermove", (event) => {
      if (!orbit || orbit.id !== event.pointerId) return;
      yaw = orbit.yaw - (event.clientX - orbit.x) * 0.008;
      pitch = Math.max(-0.35, Math.min(0.72, orbit.pitch + (event.clientY - orbit.y) * 0.006));
    });
    const endOrbit = (event) => {
      if (!orbit || orbit.id !== event.pointerId) return;
      elements.stage.releasePointerCapture?.(event.pointerId); elements.stage.classList.remove("is-dragging"); orbit = null;
    };
    elements.stage.addEventListener("pointerup", endOrbit); elements.stage.addEventListener("pointercancel", endOrbit);
    elements.stage.addEventListener("wheel", (event) => { event.preventDefault(); zoom = Math.max(1.25, Math.min(4.5, zoom * Math.exp(event.deltaY * 0.001))); }, { passive: false });
    requestAnimationFrame(draw);
    return { setMesh, resize: sizeCanvas };
  }

  function bindAttribute(gl, buffer, location) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }

  function linkProgram(gl, vertexSource, fragmentSource) {
    const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
    const program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)); return program;
  }

  function identity4() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function perspective(fov, aspect, near, far) { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); }
  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2]; let length = Math.hypot(zx, zy, zz) || 1; zx /= length; zy /= length; zz /= length;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; length = Math.hypot(xx, xy, xz) || 1; xx /= length; xy /= length; xz /= length;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
  }
  function multiply4(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
    return out;
  }

  bindEvents();
  refreshFromCurrent();
})();
