// Photo analysis: sends kitchen photos to the Anthropic Messages API and turns the answer into a
// clamped PhotoModel. Raw HTTP through the injected fetch (ctx.fetch), so tests mock it and the
// server needs no SDK dependency. Never logs the API key, the images or the model's raw answer.

import { FINISH_CHOICES, LIMITS, clampPhotoModel, photoModelJsonSchema } from './photoModel.mjs';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 6;
export const TIMEOUT_MS = 30_000;

export class AnalysisError extends Error {
  /** @param {number} status  HTTP status for our own response  @param {string} message  shown to the user */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const list = (choices) => choices.map((f) => `${f.id} (${f.name})`).join(', ');

/** The instructions. Stable text, so repeated calls can share a prompt cache. */
export function systemPrompt() {
  return [
    'You turn photos of an existing kitchen into a floor-plan model for BluModel Studio, a kitchen design app.',
    'The user will redesign the kitchen in BluModel Studio, so the model must match the room as it is now.',
    '',
    'Orientation: the wall the camera faces in the first photo is "north". Looking at it, "east" is the wall on the right, "west" on the left, "south" behind the camera. Keep this orientation for every photo; use the other photos to see the walls the first one misses.',
    'Measure in inches. Positions along a wall ("offsetIn", "startIn", "endIn") run from the west end of the north and south walls, and from the north end of the east and west walls, to the near edge of the thing.',
    'Scale from what has a standard size: base cabinets are 24 in deep and their counter 36 in high, wall cabinets 12 in deep, interior doors about 80 in tall and 30-36 in wide, ranges 30 or 36 in wide, dishwashers 24 in, fridges 30-36 in.',
    '',
    'room: width (west to east), length (north to south) and ceiling height.',
    'openings: every window and door, with its wall, offset, width, height and (windows) sill height.',
    'runs: each continuous stretch of base cabinets along a wall, start to end, and whether it has wall cabinets above.',
    'appliances: sink, range (an oven with a cooktop on top), cooktop, wall-oven, fridge, dishwasher, hood and microwave, with their wall (or "island") and offset.',
    'island: its length along its long side, depth and number of seats, or null when there is no island.',
    `style: the main cabinet colour as #rrggbb, the door style (shaker, slab, fluted, glass), and the closest of these finishes. Counter: ${list(FINISH_CHOICES.countertop)}. Backsplash: ${list(FINISH_CHOICES.backsplash)}. Floor: ${list(FINISH_CHOICES.flooring)}. Hardware: ${list(FINISH_CHOICES.hardware)}. Wall paint: ${list(FINISH_CHOICES.paint)}.`,
    'confidence: for each field, 0 when it is a guess (for example a wall no photo shows) up to 1 when it is clearly visible and measurable.',
    `notes: up to ${LIMITS.maxNotes} short sentences about what the model can't hold or what you had to guess.`,
    '',
    "Only describe what the photos show; leave out what you can't see rather than inventing it. Answer with the JSON object only.",
  ].join('\n');
}

const MEDIA = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** The Messages API request body for these images. */
export function buildRequest({ model, images }) {
  return {
    model,
    max_tokens: 16000,
    system: systemPrompt(),
    output_config: { format: { type: 'json_schema', schema: photoModelJsonSchema() } },
    messages: [
      {
        role: 'user',
        content: [
          ...images.flatMap((img, i) => [
            { type: 'text', text: `Photo ${i + 1}${i === 0 ? ' (its main wall is north)' : ''}:` },
            { type: 'image', source: { type: 'base64', media_type: MEDIA[img.ext], data: Buffer.from(img.bytes).toString('base64') } },
          ]),
          { type: 'text', text: 'Model this kitchen.' },
        ],
      },
    ],
  };
}

/** The JSON object in the model's answer: the whole text, or one fenced block. Prose fails. */
export function parseAnswer(text) {
  let s = String(text ?? '').trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(s);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Analyses 1–6 photos. Resolves `{ model, warnings }` (validated and clamped) or rejects with an
 * AnalysisError carrying the status and a message for the user.
 * @param {{ fetch: typeof fetch, apiKey: string, model: string, images: { ext: 'png'|'jpg'|'webp', bytes: Buffer }[],
 *   timeoutMs?: number, log?: { warn: Function } }} opts
 */
export async function analyzePhotos({ fetch, apiKey, model, images, timeoutMs = TIMEOUT_MS, log }) {
  if (!images.length || images.length > MAX_PHOTOS) throw new AnalysisError(400, `Choose 1 to ${MAX_PHOTOS} photos.`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  let body;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(buildRequest({ model, images })),
      signal: ac.signal,
    });
    body = await res.json().catch(() => null);
  } catch (err) {
    const timedOut = ac.signal.aborted;
    log?.warn?.(`photo analysis: ${timedOut ? 'timed out' : 'request failed'} (${err?.name ?? 'Error'})`);
    throw timedOut
      ? new AnalysisError(504, 'Photo analysis took too long. Try fewer photos, or fill in the space by hand.')
      : new AnalysisError(502, 'Photo analysis isn’t reachable right now. Fill in the space by hand, or try again later.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Status and error type only: an error body can quote the request.
    const type = typeof body?.error?.type === 'string' ? body.error.type.slice(0, 60) : '';
    log?.warn?.(`photo analysis: HTTP ${res.status} ${type}`.trim());
    if (res.status === 429 || res.status === 529 || res.status === 503) throw new AnalysisError(503, 'Photo analysis is busy right now. Try again in a minute.');
    throw new AnalysisError(502, 'Photo analysis failed. Fill in the space by hand, or try again later.');
  }
  if (body?.stop_reason === 'refusal') {
    log?.warn?.('photo analysis: declined');
    throw new AnalysisError(502, 'The photo analyser declined these photos. Fill in the space by hand.');
  }
  const text = Array.isArray(body?.content) ? body.content.filter((b) => b?.type === 'text').map((b) => b.text).join('') : '';
  const parsed = parseAnswer(text);
  const checked = parsed ? clampPhotoModel(parsed) : null;
  if (!checked) {
    log?.warn?.(`photo analysis: unusable answer (stop_reason ${String(body?.stop_reason ?? 'none').slice(0, 30)}, ${text.length} chars)`);
    throw new AnalysisError(502, 'The photo analysis came back in a form BluModel Studio can’t read. Fill in the space by hand, or try again.');
  }
  return checked;
}
