import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { normalizeUpc, scannedCode, SCAN_FORMATS } from './upc';

/**
 * Scanning a product's barcode with the phone camera, through the browser's BarcodeDetector API
 * (Chrome and Edge on Android, ChromeOS and macOS; Safari behind a flag). Feature-detected: where
 * it isn't there, the request form offers "Upload a photo of the barcode" instead. Nothing leaves
 * the device while scanning: the video is read on the page and only the digits are kept.
 */

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | ImageBitmap): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const detectorCtor = (): BarcodeDetectorCtor | null => {
  const w = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === 'function' ? w.BarcodeDetector : null;
};

let supportPromise: Promise<string[]> | null = null;

/** The UPC/EAN formats this browser can read, [] when it can't read barcodes at all. */
export function barcodeFormats(): Promise<string[]> {
  if (!supportPromise) {
    const D = detectorCtor();
    supportPromise = !D
      ? Promise.resolve([])
      : Promise.resolve(D.getSupportedFormats?.() ?? [...SCAN_FORMATS])
          .then((all) => SCAN_FORMATS.filter((f) => all.includes(f)))
          .catch(() => []);
  }
  return supportPromise;
}

/** Whether this device can scan a barcode with its camera: null while checking. */
export function useCanScan(): boolean | null {
  const [can, setCan] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const camera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
    if (!camera) {
      setCan(false);
      return;
    }
    void barcodeFormats().then((f) => live && setCan(f.length > 0));
    return () => {
      live = false;
    };
  }, []);
  return can;
}

/** Reads a UPC/EAN from a photo, where the browser can; null when it can't or finds none. */
export async function readBarcodeFromImage(file: Blob): Promise<string | null> {
  const D = detectorCtor();
  const formats = await barcodeFormats();
  if (!D || !formats.length || typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file);
    const found = await new D({ formats }).detect(bmp);
    bmp.close?.();
    for (const b of found) {
      const code = scannedCode(b.rawValue, b.format);
      const r = normalizeUpc(code);
      if (r.ok) return r.code;
    }
  } catch {
    /* an image the detector can't read: the photo itself still goes to the studio */
  }
  return null;
}

type ScanState = { kind: 'starting' } | { kind: 'scanning' } | { kind: 'error'; message: string };

/**
 * The scanner: a camera preview in a dialog. Calls `onCode` with the first UPC/EAN whose check
 * digit is right (a misread with a wrong check digit is skipped and scanning carries on), then
 * stops the camera. `onFallback` is offered when the camera can't be used.
 */
export function BarcodeScanDialog({ onCode, onClose, onFallback }: { onCode: (code: string) => void; onClose: () => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>({ kind: 'starting' });
  const done = useRef(onCode);
  done.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    (async () => {
      const D = detectorCtor();
      const formats = await barcodeFormats();
      if (!D || !formats.length) {
        setState({ kind: 'error', message: 'This browser can’t read barcodes. Type the code, or upload a photo of the barcode.' });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch (e) {
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        setState({
          kind: 'error',
          message: denied ? 'Camera access is blocked for this site. Type the code, or upload a photo of the barcode.' : 'The camera couldn’t start. Type the code, or upload a photo of the barcode.',
        });
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const v = video.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setState({ kind: 'scanning' });
      const detector = new D({ formats });
      const tick = async () => {
        if (stopped) return;
        try {
          if (v.readyState >= 2) {
            for (const b of await detector.detect(v)) {
              const r = normalizeUpc(scannedCode(b.rawValue, b.format));
              if (r.ok) {
                stop();
                navigator.vibrate?.(40);
                done.current(r.code);
                return;
              }
            }
          }
        } catch {
          /* a frame the detector couldn't read; try the next one */
        }
        timer = window.setTimeout(() => void tick(), 180);
      };
      void tick();
    })();
    return stop;
  }, []);

  return (
    <Dialog title="Scan the barcode" onClose={onClose} className="ord-scan-dialog">
      <div className="ord-scan">
        <video ref={video} className="ord-scan-video" muted playsInline autoPlay aria-label="Camera preview" />
        <div className="ord-scan-guide" aria-hidden />
        {state.kind === 'starting' && <p className="ord-scan-status">Starting the camera…</p>}
      </div>
      {state.kind === 'error' ? (
        <div className="auth-error" role="alert">
          {state.message}
        </div>
      ) : (
        <p className="dialog-copy" aria-live="polite">
          Hold the barcode flat inside the frame. It fills in by itself when the code reads clearly.
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onFallback}>
          Upload a photo instead
        </button>
        <button type="button" className="btn primary" onClick={onClose} data-autofocus>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
