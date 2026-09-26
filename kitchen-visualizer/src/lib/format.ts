/** 146.5 -> 12' 2½" ; 30 -> 2' 6" ; 8 -> 8" */
export function feetInches(totalIn: number): string {
  const sign = totalIn < 0 ? '-' : '';
  const abs = Math.abs(totalIn);
  let feet = Math.floor(abs / 12);
  let inches = Math.round((abs - feet * 12) * 2) / 2;
  if (inches >= 12) {
    feet += 1;
    inches -= 12;
  }
  const whole = Math.floor(inches);
  const half = inches - whole >= 0.5 ? '½' : '';
  const inchStr = `${whole === 0 && half ? '' : whole}${half}"`;
  if (feet === 0) return `${sign}${inchStr}`;
  return `${sign}${feet}' ${inchStr}`;
}

export function inches(n: number): string {
  const r = Math.round(n * 2) / 2;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}"`;
}

export function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function sqft(areaIn2: number): number {
  return areaIn2 / 144;
}
