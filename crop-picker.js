/**
 * crop-picker.js
 * Opens a fullscreen crop modal when the user picks a photo.
 * - Drag to reposition
 * - Pinch to zoom (touch) / scroll wheel (desktop)
 * - Circle preview in real time
 * - On confirm, crops from the original full-res image → 150×150 JPEG
 *
 * Usage:
 *   const base64 = await CropPicker.open(fileInputFile);
 *   // returns null if cancelled
 */
const CropPicker = (() => {
  const DISPLAY   = 280;   // circle viewport diameter (px)
  const OUT_SIZE  = 150;   // output JPEG size (px)
  const QUALITY   = 0.85;
  const MAX_ZOOM  = 6;     // relative to minScale (fit)

  function open(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload  = e => _showModal(e.target.result, resolve);
      reader.readAsDataURL(file);
    });
  }

  function _showModal(src, resolve) {
    /* ── State ──────────────────────────────────────────────────────── */
    let cx = 0, cy = 0;   // image center offset from circle center (px)
    let scale   = 1;
    let minScale = 1;
    let imgW = 0, imgH = 0;

    /* ── DOM ────────────────────────────────────────────────────────── */
    const overlay = _el('div', `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,0.92);
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:18px;
      -webkit-user-select:none;user-select:none;
    `);

    const title = _el('div', 'color:#fff;font:700 16px/1 system-ui;');
    title.textContent = 'Position photo';

    const hint = _el('div', 'color:rgba(255,255,255,0.45);font:13px/1 system-ui;text-align:center;');
    hint.textContent = 'Drag to reposition · Pinch / scroll to zoom';

    /* Circle viewport */
    const ring = _el('div', `
      width:${DISPLAY}px;height:${DISPLAY}px;border-radius:50%;overflow:hidden;
      border:3px solid rgba(255,255,255,0.35);position:relative;
      background:#111;touch-action:none;cursor:grab;flex-shrink:0;
    `);

    const canvas = document.createElement('canvas');
    canvas.width  = DISPLAY;
    canvas.height = DISPLAY;
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    ring.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    /* Buttons */
    const btnRow = _el('div', 'display:flex;gap:12px;');

    const cancelBtn = _el('button', `
      padding:13px 28px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);
      background:rgba(255,255,255,0.07);color:#fff;
      font:700 15px/1 system-ui;cursor:pointer;
    `);
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = _el('button', `
      padding:13px 28px;border-radius:10px;border:none;
      background:#3b82f6;color:#fff;
      font:700 15px/1 system-ui;cursor:pointer;
    `);
    confirmBtn.textContent = 'Use photo ✓';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);

    overlay.appendChild(title);
    overlay.appendChild(ring);
    overlay.appendChild(hint);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);

    /* ── Image load ─────────────────────────────────────────────────── */
    const img = new Image();
    img.onload = () => {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
      // Fit so the shorter side fills the circle
      minScale = DISPLAY / Math.min(imgW, imgH);
      scale = minScale;
      cx = 0; cy = 0;
      _draw();
    };
    img.src = src;

    /* ── Draw ───────────────────────────────────────────────────────── */
    function _draw() {
      ctx.clearRect(0, 0, DISPLAY, DISPLAY);
      const dw = imgW * scale;
      const dh = imgH * scale;
      ctx.drawImage(img,
        DISPLAY / 2 + cx - dw / 2,
        DISPLAY / 2 + cy - dh / 2,
        dw, dh
      );
    }

    /* ── Clamp: image must always cover the full circle ─────────────── */
    function _clamp() {
      const dw = imgW * scale;
      const dh = imgH * scale;
      const mx = Math.max(0, (dw - DISPLAY) / 2);
      const my = Math.max(0, (dh - DISPLAY) / 2);
      cx = Math.max(-mx, Math.min(mx, cx));
      cy = Math.max(-my, Math.min(my, cy));
    }

    /* ── Touch events ───────────────────────────────────────────────── */
    let lastTouches = [];

    ring.addEventListener('touchstart', e => {
      e.preventDefault();
      lastTouches = _copyTouches(e.touches);
    }, { passive: false });

    ring.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = _copyTouches(e.touches);

      if (t.length === 1 && lastTouches.length >= 1) {
        cx += t[0].x - lastTouches[0].x;
        cy += t[0].y - lastTouches[0].y;
      }

      if (t.length === 2 && lastTouches.length === 2) {
        const prevDist = _dist(lastTouches[0], lastTouches[1]);
        const currDist = _dist(t[0], t[1]);
        if (prevDist > 0) {
          scale = Math.max(minScale, Math.min(scale * (currDist / prevDist), minScale * MAX_ZOOM));
        }
        // Pan from midpoint
        cx += _mid(t, 'x')        - _mid(lastTouches, 'x');
        cy += _mid(t, 'y')        - _mid(lastTouches, 'y');
      }

      _clamp(); _draw();
      lastTouches = t;
    }, { passive: false });

    ring.addEventListener('touchend', e => {
      lastTouches = _copyTouches(e.touches);
    }, { passive: false });

    /* ── Mouse drag (desktop) ───────────────────────────────────────── */
    let mouseDown = false, lastMX = 0, lastMY = 0;

    ring.addEventListener('mousedown', e => {
      mouseDown = true;
      lastMX = e.clientX; lastMY = e.clientY;
      ring.style.cursor = 'grabbing';
    });
    const _onMove = e => {
      if (!mouseDown) return;
      cx += e.clientX - lastMX;
      cy += e.clientY - lastMY;
      lastMX = e.clientX; lastMY = e.clientY;
      _clamp(); _draw();
    };
    const _onUp = () => { mouseDown = false; ring.style.cursor = 'grab'; };
    document.addEventListener('mousemove', _onMove);
    document.addEventListener('mouseup',   _onUp);

    /* ── Scroll to zoom (desktop) ───────────────────────────────────── */
    ring.addEventListener('wheel', e => {
      e.preventDefault();
      scale = Math.max(minScale, Math.min(
        scale * (e.deltaY > 0 ? 0.92 : 1.08),
        minScale * MAX_ZOOM
      ));
      _clamp(); _draw();
    }, { passive: false });

    /* ── Buttons ────────────────────────────────────────────────────── */
    cancelBtn.addEventListener('click', () => {
      _cleanup();
      resolve(null);
    });

    confirmBtn.addEventListener('click', () => {
      const out  = document.createElement('canvas');
      out.width  = OUT_SIZE;
      out.height = OUT_SIZE;
      const octx = out.getContext('2d');

      // Draw from original image (full resolution → no canvas quality loss)
      const dw   = imgW * scale;
      const dh   = imgH * scale;
      const imgX = DISPLAY / 2 + cx - dw / 2;  // where image top-left is in circle
      const imgY = DISPLAY / 2 + cy - dh / 2;

      // Pixel in image space that maps to circle (0,0)
      const sx = -imgX / scale;
      const sy = -imgY / scale;
      const sw =  DISPLAY / scale;  // image pixels covered by circle width
      const sh =  DISPLAY / scale;

      octx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_SIZE, OUT_SIZE);

      _cleanup();
      resolve(out.toDataURL('image/jpeg', QUALITY));
    });

    function _cleanup() {
      document.removeEventListener('mousemove', _onMove);
      document.removeEventListener('mouseup',   _onUp);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  }

  /* ── Tiny helpers ─────────────────────────────────────────────────── */
  function _el(tag, css) {
    const e = document.createElement(tag);
    e.style.cssText = css;
    return e;
  }
  function _copyTouches(list) {
    return Array.from(list).map(t => ({ x: t.clientX, y: t.clientY }));
  }
  function _dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function _mid(arr, axis) {
    return arr.reduce((s, t) => s + t[axis], 0) / arr.length;
  }

  return { open };
})();
