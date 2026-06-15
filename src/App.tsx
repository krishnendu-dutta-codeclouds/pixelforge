import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { RawProcessor } from './utils/rawProcessor';
import { saveBlobToDownloads, saveZipToDownloads, isAndroid, isNative } from './utils/androidDownload';

interface QueueItem {
  id: number;
  file: File;
  status: 'queued' | 'busy' | 'done' | 'error';
  resultBlob: Blob | null;
  resultURL: string | null;
  error: string | null;
  width: number;
  height: number;
  thumb: string | null;
}

const App: React.FC = () => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [format, setFormat] = useState<string>('image/jpeg');
  const [quality, setQuality] = useState<number>(92);
  const [maxWidth, setMaxWidth] = useState<number>(0);
  const [keepAspect, setKeepAspect] = useState<boolean>(true);
  const [lossless, setLossless] = useState<boolean>(true);
  const [grayscale, setGrayscale] = useState<boolean>(false);
  const [sepia, setSepia] = useState<boolean>(false);

  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>('Starting…');
  const [progressFill, setProgressFill] = useState<number>(0);
  const [progressCount, setProgressCount] = useState<string>('0/0');

  const [toastMsg, setToastMsg] = useState<string>('');
  const [toastType, setToastType] = useState<string>('');
  const [showToastState, setShowToastState] = useState<boolean>(false);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cursorDotRef = useRef<HTMLDivElement>(null);
  const cursorRingRef = useRef<HTMLDivElement>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const rawProcessorRef = useRef<RawProcessor | null>(null);

  // Initialize RawProcessor
  useEffect(() => {
    rawProcessorRef.current = new RawProcessor();
  }, []);

  // Toast Helper
  const showToast = (msg: string, type = '') => {
    setToastMsg(msg);
    setToastType(type);
    setShowToastState(true);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setShowToastState(false);
    }, 2400);
  };

  // Custom Cursor Follower (Desktop only)
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;

    const cursorDot = cursorDotRef.current;
    const cursorRing = cursorRingRef.current;
    if (!cursorDot || !cursorRing) return;

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;

    const onMouseMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    window.addEventListener('mousemove', onMouseMove);

    let frameId: number;
    const loop = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      cursorDot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
      cursorRing.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      frameId = requestAnimationFrame(loop);
    };
    loop();

    const hoverables = 'a, button, .dropzone, .file-item, summary, input, select, label';
    const onMouseOver = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(hoverables)) {
        cursorRing.classList.add('hover');
        cursorDot.classList.add('hover');
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(hoverables)) {
        cursorRing.classList.remove('hover');
        cursorDot.classList.remove('hover');
      }
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      cancelAnimationFrame(frameId);
    };
  }, []);

  // Celebrate (Confetti) on success
  const celebrate = () => {
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#8b5cf6', '#22d3ee', '#f472b6', '#22c55e', '#f59e0b'];
    const particles = Array.from({ length: 80 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 100,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 14 - 4,
      g: 0.35,
      size: Math.random() * 5 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1,
    }));

    const start = performance.now();

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      particles.forEach((p) => {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.012;
        if (p.life > 0) {
          alive = true;
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x, p.y, p.size, p.size * 0.4);
        }
      });
      ctx.globalAlpha = 1;
      if (alive && performance.now() - start < 3000) {
        requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    requestAnimationFrame(draw);
  };

  // Handle Files Addition
  const handleFiles = (files: File[]) => {
    const accepted = files.filter(
      (f) =>
        /image/.test(f.type) ||
        /\.(cr2|nef|arw|dng|raf|orf|rw2|pef|srw|x3f|tiff?|png|jpe?g|webp|heic|heif|bmp)$/i.test(f.name)
    );

    if (!accepted.length) {
      showToast('No supported image files found', 'err');
      return;
    }

    const newItems = accepted.map((f, i) => ({
      id: Date.now() + i,
      file: f,
      status: 'queued' as const,
      resultBlob: null,
      resultURL: null,
      error: null,
      width: 0,
      height: 0,
      thumb: null,
    }));

    setQueue((prev) => [...prev, ...newItems]);
    showToast(`Added ${accepted.length} file${accepted.length > 1 ? 's' : ''}`);

    const WEB_FRIENDLY_REGEX = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

    // Read metadata and generate thumbnail
    newItems.forEach((item) => {
      if (!WEB_FRIENDLY_REGEX.test(item.file.name)) {
        // For RAW/non-web images, set thumb to null immediately
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, thumb: null } : q))
        );
        return;
      }

      // Use URL.createObjectURL instead of FileReader.readAsDataURL (much faster, no memory leak)
      const objectURL = URL.createObjectURL(item.file);
      const img = new Image();
      img.onload = () => {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, width: img.naturalWidth, height: img.naturalHeight, thumb: objectURL }
              : q
          )
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectURL);
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, thumb: null } : q))
        );
      };
      img.src = objectURL;
    });
  };

  const removeItem = (id: number) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item?.resultURL) URL.revokeObjectURL(item.resultURL);
      if (item?.thumb && item.thumb.startsWith('blob:')) {
        URL.revokeObjectURL(item.thumb);
      }
      return prev.filter((q) => q.id !== id);
    });
  };

  const clearQueue = () => {
    queue.forEach((item) => {
      if (item.resultURL) URL.revokeObjectURL(item.resultURL);
      if (item.thumb && item.thumb.startsWith('blob:')) {
        URL.revokeObjectURL(item.thumb);
      }
    });
    setQueue([]);
    showToast('Cleared');
  };

  const isRawFile = (file: File) => {
    // Camera RAW formats that browsers cannot natively decode
    return /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|x3f|raw|rwl|3fr|mef|mos|mrw|nrw|ptx|r3d|sr2|srf)$/i.test(file.name);
  };

  // Core Conversion logic
  const convertOne = async (item: QueueItem): Promise<{ blob: Blob; width: number; height: number }> => {
    const qValue = lossless ? 1.0 : Math.max(0.1, Math.min(1.0, quality / 100));

    // ── RAW camera files → decoded by libraw-wasm ────────────────────────────
    if (isRawFile(item.file)) {
      if (!rawProcessorRef.current) throw new Error('RAW processor not initialized');

      const result = await rawProcessorRef.current.convertToJpg(item.file, qValue, format);

      // If no resize/filter is needed, return the blob directly (fastest path)
      const needsPostProcess = (maxWidth > 0 && result.width > maxWidth) || grayscale || sepia;
      if (!needsPostProcess) {
        return { blob: result.blob, width: result.width, height: result.height };
      }

      // Re-draw on canvas for resize / filter
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Failed to load converted RAW image for post-processing'));
        i.src = result.url;
      });
      URL.revokeObjectURL(result.url);

      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (maxWidth > 0 && w > maxWidth) {
        if (keepAspect) { h = Math.round((h * maxWidth) / w); }
        w = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      applyFilters(ctx, w, h);

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), format, qValue)
      );
      return { blob, width: w, height: h };
    }

    // ── Standard web images → native browser decode ──────────────────────────
    let sourceURL: string | null = null;
    try {
      sourceURL = URL.createObjectURL(item.file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Browser could not decode this image. Try a different format.'));
        i.src = sourceURL!;
      });

      let w = img.naturalWidth;
      let h = img.naturalHeight;

      if (maxWidth > 0 && w > maxWidth) {
        if (keepAspect) { h = Math.round((h * maxWidth) / w); }
        w = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      applyFilters(ctx, w, h);

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), format, qValue)
      );
      return { blob, width: w, height: h };
    } finally {
      if (sourceURL) URL.revokeObjectURL(sourceURL);
    }
  };

  /** Apply grayscale / sepia filters in-place on a canvas context */
  const applyFilters = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (!grayscale && !sepia) return;
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      let nr = r, ng = g, nb = b;
      if (grayscale) {
        const v = 0.299 * r + 0.587 * g + 0.114 * b;
        nr = ng = nb = v;
      }
      if (sepia) {
        nr = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
        ng = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
        nb = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
      }
      d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const handleConvertAll = async () => {
    if (!queue.length) {
      showToast('Add some files first', 'err');
      return;
    }
    if (isConverting) return;

    setIsConverting(true);
    setProgressFill(0);
    setProgressText('Starting…');
    setProgressCount(`0/${queue.length}`);

    let done = 0;
    const updatedQueue = [...queue];

    for (let i = 0; i < updatedQueue.length; i++) {
      const item = updatedQueue[i];
      if (item.status === 'done') {
        done++;
        continue;
      }

      setQueue((prev) =>
        prev.map((q, idx) => (idx === i ? { ...q, status: 'busy' } : q))
      );
      setProgressText(`Converting ${item.file.name}…`);
      setProgressCount(`${done}/${queue.length}`);

      try {
        const { blob, width, height } = await convertOne(item);
        const resultURL = URL.createObjectURL(blob);
        const thumbURL = URL.createObjectURL(blob);

        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i
              ? { ...q, status: 'done', resultBlob: blob, resultURL, thumb: thumbURL, width, height }
              : q
          )
        );
      } catch (err: any) {
        console.error(err);
        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'error', error: err.message } : q))
        );
      }

      done++;
      setProgressFill((done / queue.length) * 100);
      setProgressCount(`${done}/${queue.length}`);
    }

    setProgressText(`Done · ${done}/${queue.length} processed`);
    setIsConverting(false);
    showToast('Conversion complete', 'ok');
    celebrate();
  };

  const downloadItem = async (id: number) => {
    const item = queue.find((q) => q.id === id);
    if (!item?.resultBlob) return;
    
    const ext = format === 'image/jpeg' ? 'jpg' : format.split('/')[1] || 'jpg';
    const base = item.file.name.replace(/\.[^.]+$/, '');
    const filename = `${base}.${ext}`;

    // On Android native app, use Capacitor Filesystem to save to Downloads
    if (isNative() && isAndroid()) {
      showToast('Saving to Downloads…');
      const result = await saveBlobToDownloads(item.resultBlob, filename);
      if (result.success) {
        showToast(`Saved to Downloads: ${filename}`, 'ok');
      } else {
        showToast(`Save failed: ${result.error}`, 'err');
        // Fallback to browser download
        saveAs(item.resultBlob, filename);
      }
    } else {
      // Web browser - use file-saver
      saveAs(item.resultBlob, filename);
    }
  };

  const handleDownloadAll = async () => {
    const items = queue.filter((q) => q.status === 'done' && q.resultBlob);
    if (!items.length) return;

    showToast('Packaging ZIP…');
    try {
      const ext = format === 'image/jpeg' ? 'jpg' : format.split('/')[1] || 'jpg';
      const used = new Set();
      const blobs: { blob: Blob; filename: string }[] = [];

      items.forEach((item) => {
        const base = item.file.name.replace(/\.[^.]+$/, '');
        let name = `${base}.${ext}`;
        let n = 1;
        while (used.has(name)) name = `${base}-${n++}.${ext}`;
        used.add(name);
        blobs.push({ blob: item.resultBlob!, filename: name });
      });

      const zipName = `pixelforge-${Date.now()}.zip`;

      // On Android native app, use Capacitor Filesystem
      if (isNative() && isAndroid()) {
        const result = await saveZipToDownloads(blobs, zipName);
        if (result.success) {
          showToast(`ZIP saved to Downloads: ${zipName}`, 'ok');
        } else {
          showToast(`Save failed: ${result.error}`, 'err');
          // Fallback to browser download
          const zip = new JSZip();
          blobs.forEach(({ blob, filename }) => zip.file(filename, blob));
          const blob = await zip.generateAsync({ type: 'blob' });
          saveAs(blob, zipName);
        }
      } else {
        // Web browser - use file-saver
        const zip = new JSZip();
        blobs.forEach(({ blob, filename }) => zip.file(filename, blob));
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, zipName);
        showToast('ZIP downloaded', 'ok');
      }
    } catch (err) {
      console.error(err);
      showToast('Could not build ZIP', 'err');
    }
  };

  const formatBytes = (b: number) => {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) {
      b /= 1024;
      i++;
    }
    return `${b.toFixed(b >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
  };

  const allDone = queue.length > 0 && queue.every((q) => q.status === 'done');

  return (
    <>
      {/* Background gradients (Static blur transitions, no laggy canvas loops) */}
      <div className="bg-gradient"></div>
      <div className="bg-grid"></div>

      {/* Cursor follower (hidden on touch devices via CSS) */}
      <div className="cursor-dot" ref={cursorDotRef}></div>
      <div className="cursor-ring" ref={cursorRingRef}></div>

      {/* Header */}
      <header className="site-header animate-fade-in-down">
        <div className="logo-wrap">
          <div className="logo-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7h18M3 12h18M3 17h18" />
              <circle cx="8" cy="7" r="1.5" fill="currentColor" />
              <circle cx="16" cy="12" r="1.5" fill="currentColor" />
              <circle cx="11" cy="17" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-title">PixelForge</span>
            <span className="logo-sub">RAW → Any format</span>
          </div>
        </div>

        <nav className="nav">
          <a href="#features">Features</a>
          <a href="#formats">Formats</a>
          <a href="#faq">FAQ</a>
        </nav>

        <button
          className="cta-mini"
          onClick={() => {
            const cur = document.documentElement.getAttribute('data-theme');
            const next = cur === 'light' ? '' : 'light';
            if (next) document.documentElement.setAttribute('data-theme', next);
            else document.documentElement.removeAttribute('data-theme');
          }}
        >
          <span className="dot"></span>
          <span>Ready</span>
        </button>
      </header>

      <main className="container">
        {/* Hero */}
        <section className="hero">
          <div className="hero-badge animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            <span className="pulse"></span> 100% client-side · No upload
          </div>
          <h1 className="hero-title">
            <span className="line animate-fade-in-up" style={{ animationDelay: '0.1s' }}>Convert</span>
            <span className="line gradient-text animate-fade-in-up" style={{ animationDelay: '0.15s' }}>RAW images</span>
            <span className="line animate-fade-in-up" style={{ animationDelay: '0.2s' }}>in a flash.</span>
          </h1>
          <p className="hero-sub animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
            Drop CR2, NEF, ARW, DNG, RAF, ORF and more — convert to JPEG, PNG, WebP, AVIF, BMP, TIFF.
            Fast, private, and beautifully animated.
          </p>

          <div className="hero-stats animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            <div className="stat">
              <b>20+</b>
              <span>RAW formats</span>
            </div>
            <div className="stat">
              <b>6</b>
              <span>Output types</span>
            </div>
            <div className="stat">
              <b>0</b>
              <span>Server calls</span>
            </div>
            <div className="stat">
              <b>∞</b>
              <span>Batch size</span>
            </div>
          </div>
        </section>

        {/* Converter Card */}
        <section className="converter" id="converter">
          <div className="card animate-scale-up" ref={cardRef} style={{ animationDelay: '0.35s' }}>
            {/* Drop zone */}
            <div
              className="dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('drag');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag');
                if (e.dataTransfer.files) {
                  handleFiles(Array.from(e.dataTransfer.files));
                }
              }}
            >
              <div className="dz-inner">
                <div className="dz-icon">
                  <svg
                    viewBox="0 0 64 64"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M32 8v32" />
                    <path d="M20 20l12-12 12 12" />
                    <path d="M8 44v8a4 4 0 004 4h40a4 4 0 004-4v-8" />
                  </svg>
                </div>
                <h2>Drop RAW / images here</h2>
                <p>
                  or <span className="link-like">browse files</span> from your device
                </p>
                <small>
                  Supports .CR2 .NEF .ARW .DNG .RAF .ORF .RW2 .PEF .SRW .X3F .TIFF .PNG .JPG .WEBP .HEIC
                </small>
              </div>
              <div className="dz-glow"></div>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*,.cr2,.nef,.arw,.dng,.raf,.orf,.rw2,.pef,.srw,.x3f"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) handleFiles(Array.from(e.target.files));
                }}
              />
            </div>

            {/* Controls */}
            {queue.length > 0 && (
              <div className="controls">
                <div className="ctrl-row">
                  <label className="field">
                    <span>Output format</span>
                    <select value={format} onChange={(e) => setFormat(e.target.value)}>
                      <optgroup label="Common">
                        <option value="image/jpeg">JPEG (.jpg)</option>
                        <option value="image/png">PNG (.png)</option>
                        <option value="image/webp">WebP (.webp)</option>
                        <option value="image/avif">AVIF (.avif)</option>
                      </optgroup>
                      <optgroup label="Other">
                        <option value="image/bmp">BMP (.bmp)</option>
                        <option value="image/tiff">TIFF (.tiff)</option>
                      </optgroup>
                    </select>
                  </label>

                  <label className="field">
                    <span>
                      Quality <em>{quality}%</em>
                    </span>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={quality}
                      disabled={lossless}
                      onChange={(e) => setQuality(parseInt(e.target.value))}
                    />
                  </label>

                  <label className="field">
                    <span>
                      Max width <em>{maxWidth === 0 ? 'Original' : `${maxWidth}px`}</em>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="6000"
                      step="50"
                      value={maxWidth}
                      onChange={(e) => setMaxWidth(parseInt(e.target.value))}
                    />
                  </label>

                  <label className="field checkbox" id="losslessField">
                    <input
                      type="checkbox"
                      checked={lossless}
                      onChange={(e) => setLossless(e.target.checked)}
                    />
                    <span>Lossless (q=100%)</span>
                  </label>
                </div>

                <div className="ctrl-row">
                  <label className="field checkbox">
                    <input
                      type="checkbox"
                      checked={keepAspect}
                      onChange={(e) => setKeepAspect(e.target.checked)}
                    />
                    <span>Keep aspect ratio</span>
                  </label>
                  <label className="field checkbox">
                    <input type="checkbox" />
                    <span>Strip metadata</span>
                  </label>
                  <label className="field checkbox">
                    <input
                      type="checkbox"
                      checked={grayscale}
                      onChange={(e) => setGrayscale(e.target.checked)}
                    />
                    <span>Grayscale</span>
                  </label>
                  <label className="field checkbox">
                    <input
                      type="checkbox"
                      checked={sepia}
                      onChange={(e) => setSepia(e.target.checked)}
                    />
                    <span>Sepia</span>
                  </label>
                </div>

                <div className="action-row">
                  <button className="btn ghost" onClick={clearQueue}>
                    Clear all
                  </button>
                  <button
                    className="btn primary"
                    onClick={handleConvertAll}
                    disabled={isConverting}
                  >
                    <span className="btn-label">
                      {isConverting ? 'Processing…' : 'Convert all'}
                    </span>
                    <span className="btn-icon">→</span>
                  </button>
                </div>
              </div>
            )}

            {/* File list */}
            <div className="filelist">
              {queue.map((item) => (
                <div className="file-item" key={item.id}>
                  <div className="thumb">
                    {item.thumb ? (
                      <img src={item.thumb} alt="" />
                    ) : (
                      <span>
                        {item.file.name.split('.').pop()?.toUpperCase() || 'IMG'}
                      </span>
                    )}
                  </div>
                  <div className="meta">
                    <div className="name">{item.file.name}</div>
                    <div className="info">
                      {item.width ? `${item.width}×${item.height}` : '—'} ·{' '}
                      {(item.file.name.split('.').pop() || '').toUpperCase()} ·{' '}
                      {item.status === 'done' && <span className="badge ok">Ready</span>}
                      {item.status === 'busy' && <span className="badge busy">Converting…</span>}
                      {item.status === 'error' && <span className="badge err">Failed</span>}
                      {item.status === 'queued' && <span className="badge">Queued</span>}
                    </div>
                  </div>
                  <div className="size">{formatBytes(item.file.size)}</div>
                  {item.status === 'done' ? (
                    <button
                      className="rm dl"
                      onClick={() => downloadItem(item.id)}
                      title="Download"
                      aria-label="Download"
                      style={{ color: 'var(--accent-2)', borderColor: 'rgba(34,211,238,.4)' }}
                    >
                      ↓
                    </button>
                  ) : (
                    <button className="rm" onClick={() => removeItem(item.id)} title="Remove">
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Download all */}
            {allDone && (
              <div className="download-all" id="downloadAll">
                <button className="btn primary" onClick={handleDownloadAll}>
                  <span className="btn-label">Download all as ZIP</span>
                  <span className="btn-icon">↓</span>
                </button>
              </div>
            )}

            {/* Progress */}
            {isConverting && (
              <div className="progress-wrap">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progressFill}%` }}></div>
                </div>
                <div className="progress-meta">
                  <span>{progressText}</span>
                  <span>{progressCount}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Features */}
        <section className="features" id="features">
          <h3 className="section-title">Why PixelForge</h3>
          <div className="feature-grid">
            <div className="feature">
              <div className="feat-icon">⚡</div>
              <h4>Lightning fast</h4>
              <p>Conversion runs locally on your device using Canvas and WebAssembly — no waiting on servers.</p>
            </div>
            <div className="feature">
              <div className="feat-icon">🔒</div>
              <h4>Private & secure</h4>
              <p>Files never leave your device. Perfect for confidential RAW photos.</p>
            </div>
            <div className="feature">
              <div className="feat-icon">🎨</div>
              <h4>Pro controls</h4>
              <p>Quality, resize, filters, metadata handling — full control over the output.</p>
            </div>
            <div className="feature">
              <div className="feat-icon">📦</div>
              <h4>Batch convert</h4>
              <p>Drop an entire shoot and download the result as a single zip archive.</p>
            </div>
          </div>
        </section>

        {/* Formats */}
        <section className="formats" id="formats">
          <h3 className="section-title">Supported formats</h3>
          <div className="format-grid">
            <div className="fmt in">
              <b>Input</b>
              <span>
                CR2 · NEF · ARW · DNG · RAF · ORF · RW2 · PEF · SRW · X3F · TIFF · PNG · JPG · WebP ·
                HEIC · BMP
              </span>
            </div>
            <div className="fmt out">
              <b>Output</b>
              <span>JPEG · PNG · WebP · AVIF · BMP · TIFF</span>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="faq" id="faq">
          <h3 className="section-title">FAQ</h3>
          <div className="faq-list">
            <details>
              <summary>Are my files uploaded anywhere?</summary>
              <p>
                No. All processing happens locally in the application sandbox using JavaScript and WebAssembly. No data is sent to any server.
              </p>
            </details>
            <details>
              <summary>Why does AVIF not always work?</summary>
              <p>
                AVIF encoding depends on browser/WebView support. If unsupported, the output format falls back to JPEG.
              </p>
            </details>
            <details>
              <summary>How are RAW files decoded?</summary>
              <p>
                RAW files are decoded using highly optimized WebAssembly bindings compiled from C++ LibRaw, debayering details off the main thread.
              </p>
            </details>
            <details>
              <summary>Is there a file size limit?</summary>
              <p>Only the limits of your device's memory. Very large batches may slow down older devices.</p>
            </details>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>
          © {new Date().getFullYear()} PixelForge · Crafted with WebAssembly
        </span>
        <span className="muted">Convert RAW to anything, offline on your device.</span>
      </footer>

      {/* Toast (Native transitions) */}
      <div className={`toast ${showToastState ? 'show' : ''}`} role="status" aria-live="polite" data-type={toastType}>
        {toastMsg}
      </div>

      {/* Confetti canvas */}
      <canvas id="confetti" ref={confettiCanvasRef}></canvas>
    </>
  );
};

export default App;
