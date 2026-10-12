/**
 * The travel card's printing, as maths both clients draw: the guilloché security rosette behind the
 * fields, and the speckles where a rubber stamp missed the paper. Pure and deterministic, so the
 * phone and the web print the same card.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A hypotrochoid rosette on the right half and a band of fine waves along the bottom. */
export function guillochePaths(width: number, height: number): string[] {
  const paths: string[] = [];
  const cx = width * 0.73;
  const cy = height * 0.45;
  const scale = height / 660;
  const R = 210 * scale;
  const r = (210 / 5.7) * scale; // (R-r)/r = 47/10: the curve closes after 10 turns
  const d = 150 * scale;
  for (let k = 0; k < 2; k++) {
    let s = "";
    for (let t = 0, i = 0; t <= Math.PI * 2 * 10; t += 0.03, i++) {
      const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t + k * 0.08);
      const y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t + k * 0.08);
      s += `${i === 0 ? "M" : "L"}${r2(x)} ${r2(y)}`;
    }
    paths.push(`${s}Z`);
  }
  for (let i = 0; i < 12; i++) {
    let s = "";
    for (let x = 0, j = 0; x <= width; x += 6, j++) {
      const y = height * 0.72 + i * (height * 0.018) + Math.sin(x / (width / 12) + i * 0.5) * height * 0.014;
      s += `${j === 0 ? "M" : "L"}${r2(x)} ${r2(y)}`;
    }
    paths.push(s);
  }
  return paths;
}

/** Small dots in 0–1 coordinates, the same for the same seed (mulberry32). */
export function speckles(seed: number, count: number): { x: number; y: number; r: number }[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({ x: rand(), y: rand(), r: 0.004 + rand() * 0.012 }));
}
