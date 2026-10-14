let seq = 0;

export function makeId(): string {
  seq = (seq + 1) % 1_000_000;
  return `it-${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;
}
