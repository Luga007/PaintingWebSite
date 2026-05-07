
(function () {
  "use strict";

  /* ── DOM refs ─────────────────────────────────────────── */
  const canvas        = document.getElementById("canvas");
  const ctx           = canvas.getContext("2d");
  const preview       = document.getElementById("preview-canvas");
  const pctx          = preview.getContext("2d");
  const colorPicker   = document.getElementById("colorPicker");
  const colorPreview  = document.getElementById("colorPreview");
  const sizeSlider    = document.getElementById("sizeSlider");
  const sizeDisplay   = document.getElementById("sizeDisplay");
  const opacitySlider = document.getElementById("opacitySlider");
  const opacityDisplay= document.getElementById("opacityDisplay");
  const coordDisplay  = document.getElementById("coordDisplay");
  const canvasSizeDisplay = document.getElementById("canvasSizeDisplay");
  const toolBtns      = document.querySelectorAll(".tool-btn");
  const swatches      = document.querySelectorAll(".swatch");
  const undoBtn       = document.getElementById("undoBtn");
  const redoBtn       = document.getElementById("redoBtn");
  const clearBtn      = document.getElementById("clearBtn");
  const saveBtn       = document.getElementById("saveBtn");

  /* ── State ────────────────────────────────────────────── */
  let tool      = "pen";
  let color     = "#222222";
  let lineWidth = 5;
  let opacity   = 1;
  let drawing   = false;
  let startX = 0, startY = 0;
  let lastX  = 0, lastY  = 0;

  const UNDO_LIMIT = 50;
  let undoStack = [];
  let redoStack = [];

  /* ── Canvas sizing ────────────────────────────────────── */
  function resizeCanvas() {
    const area  = document.getElementById("canvas-area");
    const W = Math.floor(area.clientWidth  * 0.92);
    const H = Math.floor(area.clientHeight * 0.92);

    // Save current drawing
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

    canvas.width  = W;
    canvas.height = H;
    preview.width  = W;
    preview.height = H;

    canvas.style.width  = W + "px";
    canvas.style.height = H + "px";
    preview.style.width  = W + "px";
    preview.style.height = H + "px";

    // Restore white background then drawing
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.putImageData(img, 0, 0);

    canvasSizeDisplay.textContent = `${W} × ${H}`;
  }

  window.addEventListener("resize", resizeCanvas);

  /* ── Initial snapshot (blank canvas) ──────────────────── */
  function initCanvas() {
    resizeCanvas();
    saveSnapshot();
  }

  /* ── Undo / Redo ──────────────────────────────────────── */
  function saveSnapshot() {
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(snap);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    updateHistoryBtns();
  }

  function undo() {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    const snap = undoStack[undoStack.length - 1];
    ctx.putImageData(snap, 0, 0);
    updateHistoryBtns();
  }

  function redo() {
    if (!redoStack.length) return;
    const snap = redoStack.pop();
    undoStack.push(snap);
    ctx.putImageData(snap, 0, 0);
    updateHistoryBtns();
  }

  function updateHistoryBtns() {
    undoBtn.disabled = undoStack.length <= 1;
    redoBtn.disabled = redoStack.length === 0;
  }

  /* ── Color + Opacity helpers ──────────────────────────── */
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function applyColor(hex) {
    color = hex;
    colorPicker.value = hex;
    colorPreview.style.background = hex;
    swatches.forEach(s => s.classList.toggle("active", s.dataset.color === hex));
  }

  function getDrawColor() {
    return hexToRgba(color, opacity);
  }

  /* ── Pointer coords ───────────────────────────────────── */
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: Math.round(src.clientX - rect.left),
      y: Math.round(src.clientY - rect.top)
    };
  }

  /* ── Freehand drawing (pen / brush / eraser) ──────────── */
  function setupStroke() {
    ctx.lineCap    = "round";
    ctx.lineJoin   = "round";
    ctx.lineWidth  = lineWidth;
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = getDrawColor();
      if (tool === "brush") {
        ctx.lineWidth  = lineWidth * 2.5;
        ctx.globalAlpha = opacity * 0.6;
      } else {
        ctx.globalAlpha = 1; // opacity baked into rgba
      }
    }
  }

  /* ── Fill (flood fill) ─────────────────────────────────── */
  function floodFill(startX, startY, fillColor) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data      = imageData.data;
    const w         = canvas.width;
    const h         = canvas.height;
    const idx       = (startY * w + startX) * 4;

    const targetR = data[idx],   targetG = data[idx+1];
    const targetB = data[idx+2], targetA = data[idx+3];

    // Parse fill color
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = 1;
    const tc = tmp.getContext("2d");
    tc.fillStyle = fillColor;
    tc.fillRect(0,0,1,1);
    const [fr, fg, fb, fa8] = tc.getImageData(0,0,1,1).data;
    const fa = Math.round(opacity * 255);

    if (targetR===fr && targetG===fg && targetB===fb && targetA===fa) return;

    function match(i) {
      return Math.abs(data[i]-targetR)   < 20 &&
             Math.abs(data[i+1]-targetG) < 20 &&
             Math.abs(data[i+2]-targetB) < 20 &&
             Math.abs(data[i+3]-targetA) < 20;
    }

    const stack = [[startX, startY]];
    const visited = new Uint8Array(w * h);

    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      const i = cy * w + cx;
      if (visited[i]) continue;
      const pi = i * 4;
      if (!match(pi)) continue;
      visited[i] = 1;
      data[pi]   = fr;
      data[pi+1] = fg;
      data[pi+2] = fb;
      data[pi+3] = fa;
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }

    ctx.putImageData(imageData, 0, 0);
  }

  /* ── Shape preview ────────────────────────────────────── */
  function drawShapePreview(x, y) {
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.strokeStyle = getDrawColor();
    pctx.lineWidth   = lineWidth;
    pctx.lineCap     = "round";
    pctx.setLineDash([]);

    if (tool === "line") {
      pctx.beginPath();
      pctx.moveTo(startX, startY);
      pctx.lineTo(x, y);
      pctx.stroke();
    } else if (tool === "rect") {
      pctx.strokeRect(startX, startY, x - startX, y - startY);
    } else if (tool === "circle") {
      const rx = Math.abs(x - startX) / 2;
      const ry = Math.abs(y - startY) / 2;
      const cx = startX + (x - startX) / 2;
      const cy = startY + (y - startY) / 2;
      pctx.beginPath();
      pctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      pctx.stroke();
    }
  }

  function commitShape(x, y) {
    pctx.clearRect(0, 0, preview.width, preview.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.strokeStyle = getDrawColor();
    ctx.lineWidth   = lineWidth;
    ctx.lineCap     = "round";

    if (tool === "line") {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (tool === "rect") {
      ctx.strokeRect(startX, startY, x - startX, y - startY);
    } else if (tool === "circle") {
      const rx = Math.abs(x - startX) / 2;
      const ry = Math.abs(y - startY) / 2;
      const cx = startX + (x - startX) / 2;
      const cy = startY + (y - startY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* ── Pointer events ───────────────────────────────────── */
  function onPointerDown(e) {
    e.preventDefault();
    const { x, y } = getPos(e);
    drawing = true;
    startX = lastX = x;
    startY = lastY = y;

    if (tool === "fill") {
      floodFill(x, y, color);
      saveSnapshot();
      drawing = false;
      return;
    }

    if (tool === "pen" || tool === "brush" || tool === "eraser") {
      setupStroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.1, y + 0.1); // dot
      ctx.stroke();
    }
  }

  function onPointerMove(e) {
    e.preventDefault();
    const { x, y } = getPos(e);
    coordDisplay.textContent = `x: ${x}, y: ${y}`;

    if (!drawing) return;

    if (tool === "pen" || tool === "brush" || tool === "eraser") {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      drawShapePreview(x, y);
    }

    lastX = x; lastY = y;
  }

  function onPointerUp(e) {
    if (!drawing) return;
    drawing = false;

    if (tool === "line" || tool === "rect" || tool === "circle") {
      const { x, y } = getPos(e);
      commitShape(x, y);
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.beginPath();
    saveSnapshot();
  }

  canvas.addEventListener("mousedown",  onPointerDown);
  canvas.addEventListener("mousemove",  onPointerMove);
  canvas.addEventListener("mouseup",    onPointerUp);
  canvas.addEventListener("mouseleave", onPointerUp);

  canvas.addEventListener("touchstart",  onPointerDown, { passive: false });
  canvas.addEventListener("touchmove",   onPointerMove, { passive: false });
  canvas.addEventListener("touchend",    onPointerUp,   { passive: false });

  /* ── Toolbar interactions ─────────────────────────────── */
  toolBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      toolBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      tool = btn.dataset.tool;
      document.body.dataset.tool = tool;
    });
  });

  colorPicker.addEventListener("input", () => applyColor(colorPicker.value));

  swatches.forEach(s => {
    s.addEventListener("click", () => applyColor(s.dataset.color));
  });

  sizeSlider.addEventListener("input", () => {
    lineWidth = parseInt(sizeSlider.value);
    sizeDisplay.textContent = lineWidth;
  });

  opacitySlider.addEventListener("input", () => {
    opacity = parseInt(opacitySlider.value) / 100;
    opacityDisplay.textContent = opacitySlider.value + "%";
  });

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  clearBtn.addEventListener("click", () => {
    if (confirm("Clear the canvas?")) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      saveSnapshot();
    }
  });

  saveBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "painting-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  /* ── Keyboard shortcuts ───────────────────────────────── */
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); saveBtn.click(); return; }

    const toolMap = { p:"pen", b:"brush", e:"eraser", f:"fill", l:"line", r:"rect", c:"circle" };
    if (toolMap[k] && !e.ctrlKey && !e.metaKey) {
      toolBtns.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tool === toolMap[k]);
      });
      tool = toolMap[k];
      document.body.dataset.tool = tool;
    }
  });

  /* ── Init ─────────────────────────────────────────────── */
  applyColor(color);
  updateHistoryBtns();
  initCanvas();

})();
