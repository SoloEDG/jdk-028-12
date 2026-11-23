/** 可重现随机数（mulberry32）：同一种子产生同一序列 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randomInt(rng: () => number, bound: number): number {
  return Math.floor(rng() * bound);
}
/** 课堂级口令散列（FNV-1a，非密码学用途） */
export function fnvHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
/**
 * 真值表位掩码：第 row 位表示该输入组合下的取值。
 * 输入数量不超过 4（最多 16 行），所以 32 位整数足够。
 */
export function fullMask(rowCount: number): number {
  return rowCount >= 31 ? -1 : (1 << rowCount) - 1;
}
/** 第 index 个输入端的掩码（index 0 为最高位，即真值表最左列） */
export function inputMask(inputCount: number, index: number): number {
  const shift = inputCount - 1 - index;
  let mask = 0;
  for (let row = 0; row < 1 << inputCount; row++)
    if ((row >> shift) & 1) mask |= 1 << row;
  return mask;
}
/** 目标真值表第 output 列的掩码 */
export function targetMask(
  target: (0 | 1)[][],
  output: number,
): number {
  let mask = 0;
  for (let row = 0; row < target.length; row++)
    if (target[row][output]) mask |= 1 << row;
  return mask;
}
