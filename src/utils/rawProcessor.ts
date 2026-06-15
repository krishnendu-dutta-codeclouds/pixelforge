import LibRaw from 'libraw-wasm';

export interface ProcessedImage {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  originalSize: number;
  newSize: number;
}

export class RawProcessor {
  private libRaw: InstanceType<typeof LibRaw>;

  constructor() {
    this.libRaw = new LibRaw();
  }

  /**
   * Helper to execute a promise with a timeout.
   */
  private _withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(timeoutMsg));
      }, ms);

      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Convert a RAW camera file to JPEG (or any target mime type).
   * Strategy (in priority order):
   *   1. Full demosaic via libraw-wasm imageData() — true full-quality decode
   *   2. Embedded thumbnail/preview — all modern RAW files have one; often near-full-res
   *   3. Throw a readable error
   */
  async convertToJpg(
    file: File,
    quality: number = 0.92,
    mimeType: string = 'image/jpeg'
  ): Promise<ProcessedImage> {
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    // Open the RAW file once — we'll try full decode, fall back to thumbnail
    try {
      console.log('Opening RAW file with libraw-wasm');
      await this._withTimeout(
        this.libRaw.open(uint8Array, {
          useCameraWb: true,       // Use camera white balance
          outputColor: 1,          // sRGB output
          outputBps: 8,            // 8-bit output
          userQual: 3,             // AHD demosaicing (highest quality)
          noAutoScale: false,
          noAutoBright: false,
        }),
        15000,
        'Opening RAW file timed out (15s)'
      );
    } catch (openErr) {
      throw new Error(`Cannot open RAW file "${file.name}": ${openErr}`);
    }

    // ── Strategy 1: Full demosaic ────────────────────────────────────────────
    try {
      console.log('Attempting full demosaic via imageData()');
      const imgData = await this._withTimeout(
        this.libRaw.imageData(),
        25000,
        'Demosaic operation timed out (25s)'
      );

      if (imgData && imgData.data && imgData.width > 0 && imgData.height > 0) {
        console.log(`Full decode succeeded: ${imgData.width}x${imgData.height}, colors=${imgData.colors}`);
        const { width, height, colors, data } = imgData;
        const expectedSize = width * height * colors;

        if (data.length >= expectedSize) {
          const blob = await this._pixelDataToBlob(data, width, height, colors, quality, mimeType);
          if (blob) {
            return {
              blob,
              url: URL.createObjectURL(blob),
              width,
              height,
              originalSize: file.size,
              newSize: blob.size,
            };
          }
        }
      }
    } catch (fullDecodeErr) {
      console.warn('Full RAW decode failed, trying embedded thumbnail:', fullDecodeErr);
    }

    // ── Strategy 2: Embedded thumbnail (JPEG preview inside the RAW) ─────────
    try {
      console.log('Attempting thumbnail extraction via thumbnailData()');
      const thumbData = await this._withTimeout(
        this.libRaw.thumbnailData(),
        15000,
        'Thumbnail extraction timed out (15s)'
      );

      if (thumbData && thumbData.data && thumbData.data.length > 0) {
        if (thumbData.format === 'jpeg') {
          console.log(`Thumbnail JPEG extracted: ${thumbData.width}x${thumbData.height}`);
          // The embedded thumbnail is already a JPEG — decode it and re-encode
          const jpegBlob = new Blob([thumbData.data as any], { type: 'image/jpeg' });
          const blob = await this._blobToOutputBlob(jpegBlob, quality, mimeType);
          if (blob) {
            return {
              blob,
              url: URL.createObjectURL(blob),
              width: thumbData.width,
              height: thumbData.height,
              originalSize: file.size,
              newSize: blob.size,
            };
          }
        } else if (thumbData.format === 'bitmap') {
          console.log(`Thumbnail bitmap extracted: ${thumbData.width}x${thumbData.height}`);
          // Bitmap thumbnail (RGB triplets)
          const { data, width, height } = thumbData;
          const blob = await this._pixelDataToBlob(data, width, height, 3, quality, mimeType);
          if (blob) {
            return {
              blob,
              url: URL.createObjectURL(blob),
              width,
              height,
              originalSize: file.size,
              newSize: blob.size,
            };
          }
        }
      }
    } catch (thumbErr) {
      console.warn('Thumbnail extraction failed:', thumbErr);
    }

    throw new Error(
      `Could not decode RAW file "${file.name}". The format may be unsupported.`
    );
  }

  /**
   * Convert a raw pixel buffer (RGB or RGBA) to a canvas-backed Blob.
   */
  private _pixelDataToBlob(
    data: Uint8Array | Uint16Array | { [k: number]: number; length: number },
    width: number,
    height: number,
    colors: number,
    quality: number,
    mimeType: string
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      if (!ctx) { resolve(null); return; }

      const imageData = ctx.createImageData(width, height);
      const dest = imageData.data; // Uint8ClampedArray, RGBA

      const pixelCount = width * height;

      if (colors === 3) {
        // RGB → RGBA
        for (let i = 0; i < pixelCount; i++) {
          const si = i * 3;
          const di = i * 4;
          dest[di]     = (data as any)[si];
          dest[di + 1] = (data as any)[si + 1];
          dest[di + 2] = (data as any)[si + 2];
          dest[di + 3] = 255;
        }
      } else if (colors === 4) {
        // RGBX / RGBA → RGBA (copy verbatim, force alpha = 255)
        for (let i = 0; i < pixelCount; i++) {
          const si = i * 4;
          const di = i * 4;
          dest[di]     = (data as any)[si];
          dest[di + 1] = (data as any)[si + 1];
          dest[di + 2] = (data as any)[si + 2];
          dest[di + 3] = 255;
        }
      } else {
        // Grayscale or unexpected — replicate channel to RGB
        for (let i = 0; i < pixelCount; i++) {
          const v = (data as any)[i * colors];
          const di = i * 4;
          dest[di] = dest[di + 1] = dest[di + 2] = v;
          dest[di + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });
  }

  /**
   * Decode a Blob via an Image element, draw to canvas, and re-export.
   */
  private _blobToOutputBlob(
    inputBlob: Blob,
    quality: number,
    mimeType: string
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(inputBlob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => resolve(blob), mimeType, quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
}
