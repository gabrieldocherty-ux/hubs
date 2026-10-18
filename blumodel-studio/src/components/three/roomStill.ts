/**
 * Offscreen stills of the room (BUILD_PLAN A-T8): the Studio render dialog and the TopBar's 3D
 * PNG. The live canvas's drawing buffer is resized to the target (CSS size untouched), the
 * composer renders one frame with the requested camera, quality and tone mapping, the pixels are
 * copied to a 2D canvas in the same task (the drawing buffer isn't preserved), and everything is
 * restored before the next on-screen frame. The result doesn't depend on the size of the canvas
 * on screen, so split view no longer gives a half-width image.
 */
import type { RootState } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { Room } from '../../types';
import { capSize, useRoomQuality, type StillOptions } from '../../features/viewer/studio';
import { roomEffects, toneMode } from './roomEffects';
import { presetFor, stillFov } from './cameraPresets';
import { applyCutaway } from './Room3D';

/** The longest side this GPU can render offscreen, capped at 4096 (PRODUCT_SPEC §5.5). */
export function roomMaxSide(gl: THREE.WebGLRenderer): number {
  const c = gl.getContext();
  const rb = Number(c.getParameter(c.MAX_RENDERBUFFER_SIZE)) || 4096;
  const vp = c.getParameter(c.MAX_VIEWPORT_DIMS) as Int32Array | number[] | null;
  const vpMin = vp ? Math.min(Number(vp[0]), Number(vp[1])) : 4096;
  return Math.max(256, Math.min(4096, gl.capabilities.maxTextureSize, rb, vpMin));
}

let busy = false;
/** True while a still is rendering (the frame governor ignores that frame). */
export const studioBusy = () => busy;

/**
 * MSAA samples for a still: 8× for High up to 1440p, 4× above (a 4K half-float 8× buffer is
 * ~0.5 GB and fails on ordinary GPUs); Fast uses half that. Never above the GPU's maximum.
 */
export function stillSamples(quality: StillOptions['quality'], pixels: number, maxSamples: number): number {
  const big = pixels > 5_000_000;
  const want = quality === 'high' ? (big ? 4 : 8) : big ? 2 : 4;
  return Math.max(0, Math.min(want, maxSamples));
}

function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#f7f2ea');
  g.addColorStop(1, bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export async function renderRoomStill(get: () => RootState, o: StillOptions, room: Room, bg: string): Promise<HTMLCanvasElement> {
  const state = get();
  const { gl, size, invalidate } = state;
  const camera = state.camera as THREE.PerspectiveCamera;
  const controls = state.controls as unknown as OrbitControlsImpl | null;
  const { composer, ao, tone } = roomEffects;
  if (!composer) throw new Error('The 3D view isn’t ready yet.');
  if (busy) throw new Error('A render is already running.');
  const cap = capSize(o.width, o.height, roomMaxSide(gl));
  const w = Math.max(16, cap.width);
  const h = Math.max(16, cap.height);

  busy = true;
  const saved = {
    pos: camera.position.clone(),
    quat: camera.quaternion.clone(),
    aspect: camera.aspect,
    fov: camera.fov,
    target: controls?.target.clone() ?? null,
    pixelRatio: gl.getPixelRatio(),
    samples: composer.multisampling,
    aoEnabled: ao?.enabled ?? false,
    aoHalfRes: ao?.configuration.halfRes ?? true,
  };
  const live = useRoomQuality.getState();
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  try {
    // Camera: the current view (reframed for the image's aspect, see stillFov) or a preset.
    if (o.view) camera.fov = o.view.fov ?? saved.fov;
    else if (o.camera === 'current') camera.fov = stillFov(saved.fov, saved.aspect, w / h);
    camera.aspect = w / h;
    if (o.view) {
      camera.position.set(...o.view.pos);
      camera.lookAt(new THREE.Vector3(...o.view.target));
    } else if (o.camera !== 'current') {
      const { pos, target } = presetFor(o.camera, room, w / h);
      camera.position.copy(pos);
      camera.lookAt(target);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    applyCutaway(camera.position);

    // Quality: High = full-resolution AO at its high setting and more MSAA; Fast = the
    // on-screen look (half-resolution AO).
    composer.multisampling = stillSamples(o.quality, w * h, gl.capabilities.maxSamples);
    if (ao) {
      ao.enabled = true;
      ao.configuration.halfRes = o.quality !== 'high';
      ao.setQualityMode(o.quality === 'high' ? 'High' : 'Medium');
    }
    if (tone) tone.mode = toneMode(o.toneMap);

    gl.setPixelRatio(1);
    composer.setSize(w, h, false);
    gl.shadowMap.needsUpdate = true;
    composer.render(0);

    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('This browser can’t make the image.');
    paintBackground(ctx, w, h, bg);
    ctx.drawImage(gl.domElement, 0, 0, w, h);
  } finally {
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    camera.aspect = saved.aspect;
    camera.fov = saved.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (controls && saved.target) controls.target.copy(saved.target);
    composer.multisampling = saved.samples;
    if (ao) {
      ao.configuration.halfRes = saved.aoHalfRes;
      ao.setQualityMode('Medium');
      ao.enabled = saved.aoEnabled;
    }
    if (tone) tone.mode = toneMode(live.toneMap);
    gl.setPixelRatio(saved.pixelRatio);
    composer.setSize(size.width, size.height, false);
    applyCutaway(camera.position);
    gl.shadowMap.needsUpdate = true;
    busy = false;
    invalidate();
  }
  return out;
}
