type Exporter = () => Promise<string | null>;

const registry: { plan?: Exporter; scene?: Exporter } = {};

export function registerExporter(kind: 'plan' | 'scene', fn: Exporter | undefined) {
  registry[kind] = fn;
}

export async function exportImage(kind: 'plan' | 'scene'): Promise<string | null> {
  const fn = registry[kind];
  return fn ? fn() : null;
}

export function hasExporter(kind: 'plan' | 'scene'): boolean {
  return !!registry[kind];
}

export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  downloadDataUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kitchen';
}

export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
