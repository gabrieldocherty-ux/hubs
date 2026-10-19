// Image fixtures for tests: a real deflate PNG, sniffable JPEG and WebP headers, and an
// SVG that must always be rejected. Generators live in server/lib/synth.mjs.
export { makePng, makeJpeg, makeWebp, svgBytes } from '../../lib/synth.mjs';
