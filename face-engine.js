/**
 * face-engine.js
 * Wraps @vladmandic/face-api for face detection and recognition.
 * Exposes two methods:
 *   FaceEngine.extractDescriptor(base64) → Promise<Array<number>|null>
 *   FaceEngine.recognizeGroup(file, people, onProgress) → Promise<Array<{...}>>
 */
const FaceEngine = (() => {
  const CDN_SCRIPT = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/dist/face-api.js';
  const MODEL_URL  = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model';

  let _baseLoadPromise = null;  // tiny + landmarks + recognition (~1MB total)
  let _fullLoadPromise = null;  // + SSD MobileNet (~6MB, only for group detection)

  /** Load script + lightweight models (used by extractDescriptor). */
  function _ensureBase() {
    if (_baseLoadPromise) return _baseLoadPromise;

    _baseLoadPromise = (async () => {
      if (!window.faceapi) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = CDN_SCRIPT;
          s.onload  = resolve;
          s.onerror = () => reject(new Error('Failed to load face-api.js from CDN'));
          document.head.appendChild(s);
        });
      }

      const faceapi = window.faceapi;

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);

      // Warm up tiny detector
      const warmup = document.createElement('canvas');
      warmup.width = 64; warmup.height = 64;
      await faceapi.detectAllFaces(warmup,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.9, inputSize: 128 }));

      return faceapi;
    })();

    return _baseLoadPromise;
  }

  /** Load SSD MobileNet on top of base (used by recognizeGroup). */
  function _ensureFull() {
    if (_fullLoadPromise) return _fullLoadPromise;

    _fullLoadPromise = (async () => {
      const faceapi = await _ensureBase();

      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);

      // Warm up SSD
      const warmup = document.createElement('canvas');
      warmup.width = 64; warmup.height = 64;
      await faceapi.detectAllFaces(warmup,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.9 }));

      return faceapi;
    })();

    return _fullLoadPromise;
  }

  /**
   * Create an HTMLImageElement from a base64 data URL or plain base64 string.
   */
  function _imgFromBase64(base64) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('Cannot decode image'));
      img.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    });
  }

  /**
   * Resize an HTMLImageElement to at most maxW wide, preserving aspect ratio.
   * Returns an HTMLCanvasElement.
   */
  function _resizeToCanvas(img, maxW) {
    const scale  = Math.min(1, maxW / img.naturalWidth);
    const width  = Math.round(img.naturalWidth  * scale);
    const height = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return canvas;
  }

  /**
   * Crop a face region (with padding) from a canvas and return an 80×80 JPEG data URL.
   */
  function _cropFace(canvas, box, padding = 0.25) {
    const { x, y, width: w, height: h } = box;
    const padX = Math.round(w * padding);
    const padY = Math.round(h * padding);
    const sx = Math.max(0, x - padX);
    const sy = Math.max(0, y - padY);
    const sw = Math.min(canvas.width  - sx, w + padX * 2);
    const sh = Math.min(canvas.height - sy, h + padY * 2);

    const out = document.createElement('canvas');
    out.width  = 80;
    out.height = 80;
    out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, 80, 80);
    return out.toDataURL('image/jpeg', 0.82);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Extract a face descriptor from a single-person reference photo (150×150 base64).
   * Returns a plain Array<number> (serializable) or null if no face detected.
   */
  async function extractDescriptor(base64) {
    const faceapi = await _ensureBase();
    const img     = await _imgFromBase64(base64);

    // Try TinyFaceDetector first (fast). If it misses (common for angled faces),
    // fall back to SSD MobileNet which handles non-frontal faces much better.
    let result = await faceapi
      .detectSingleFace(img,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.2, inputSize: 224 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!result) {
      // SSD fallback — loads the heavier model on demand
      const faceapiFull = await _ensureFull();
      result = await faceapiFull
        .detectSingleFace(img,
          new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();
    }

    if (!result) return null;

    // Convert Float32Array → plain Array so it can be stored in IndexedDB / JSON
    return Array.from(result.descriptor);
  }

  /**
   * Detect and recognize faces in a group photo.
   *
   * @param {File}   file        - The group photo file
   * @param {Array}  people      - Array of { id, short, full, category, descriptors: Array<Array<number>> }
   *                               Only entries WITH descriptors are used for matching
   * @param {Function} onProgress - Optional callback(msg)
   * @returns {Promise<Array<{ box:{x,y,w,h}, matchId:string|null, distance:number, faceDataUrl:string }>>}
   */
  async function recognizeGroup(file, people, onProgress) {
    const faceapi = await _ensureFull();
    const progress = typeof onProgress === 'function' ? onProgress : () => {};

    progress('Loading image…');

    // Load file as image
    const objectUrl = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload  = () => resolve(i);
      i.onerror = () => reject(new Error('Cannot decode image file'));
      i.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);

    // Resize to max 1800px wide (keeps faces large enough for detection)
    const canvas = _resizeToCanvas(img, 1800);

    progress('Detecting faces…');

    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 });
    const detections = await faceapi
      .detectAllFaces(canvas, options)
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    if (!detections.length) return [];

    progress(`Matching ${detections.length} face(s)…`);

    // Build LabeledFaceDescriptors for people who have descriptors
    const labeled = people
      .filter(p => Array.isArray(p.descriptors) && p.descriptors.length)
      .map(p => new faceapi.LabeledFaceDescriptors(
        p.id,
        p.descriptors.map(d => new Float32Array(d))
      ));

    const THRESHOLD = 0.45;
    const matcher = labeled.length
      ? new faceapi.FaceMatcher(labeled, THRESHOLD)
      : null;

    const results = detections.map(det => {
      const { x, y, width: w, height: h } = det.detection.box;
      const box = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      const faceDataUrl = _cropFace(canvas, det.detection.box);

      let matchId  = null;
      let distance = 1;

      if (matcher) {
        const best = matcher.findBestMatch(det.descriptor);
        if (best.label !== 'unknown') {
          matchId  = best.label;
          distance = best.distance;
        } else {
          distance = best.distance;
        }
      }

      return { box, matchId, distance, faceDataUrl };
    });

    // Sort left-to-right by box.x
    results.sort((a, b) => a.box.x - b.box.x);

    progress('Done');
    return results;
  }

  return { extractDescriptor, recognizeGroup };
})();
