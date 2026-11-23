import type { GateKind } from "@/shared/types";

/**
 * 输入脚可交换的门。当前元件库中所有双输入门都可交换，
 * 单输入 NOT 无所谓顺序；保留此表以便将来加入不可交换门。
 */
const COMMUTATIVE: ReadonlySet<GateKind> = new Set([
  "AND",
  "OR",
  "XOR",
  "NAND",
  "NOR",
]);
export function pinsCommutative(kind: GateKind): boolean {
  return COMMUTATIVE.has(kind);
}

export interface CanonGate {
  id: string;
  kind: GateKind;
}
export interface CanonWire {
  fromId: string;
  toId: string;
  toPort: number;
}

/**
 * 计算一份接法的结构规范键：
 * 输入、输出、固定门保持身份；库存门只按类型区分，
 * 同种门编号任意交换、可交换门的输入脚任意互换后，
 * 键相同当且仅当两份接法结构相同。
 * 真值表相同但结构不同的接法会得到不同的键。
 */
export function canonicalKey(
  inputIds: readonly string[],
  outputIds: readonly string[],
  fixedGates: readonly CanonGate[],
  usedGates: readonly CanonGate[],
  wires: readonly CanonWire[],
): string {
  const fixedSorted = [...fixedGates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const slotIds: string[] = [...inputIds, ...outputIds];
  const slotKinds: (GateKind | null)[] = [
    ...inputIds.map(() => null),
    ...outputIds.map(() => null),
  ];
  const fixedIndex = new Map<string, number>();
  slotIds.forEach((id, index) => fixedIndex.set(id, index));
  for (const gate of fixedSorted) {
    fixedIndex.set(gate.id, slotIds.length);
    slotIds.push(gate.id);
    slotKinds.push(gate.kind);
  }
  const usedStart = slotIds.length;
  const usedKinds = new Map(usedGates.map((gate) => [gate.id, gate.kind]));

  // 按类型分组，对每组生成全部排列，组合后逐一序列化取最小。
  // 组顺序必须固定（按类型名排序），否则同一电路会因门的编号不同而得到不同的键。
  const byKind = new Map<GateKind, string[]>();
  for (const gate of usedGates) {
    const list = byKind.get(gate.kind) ?? [];
    list.push(gate.id);
    byKind.set(gate.kind, list);
  }
  const groups = [...byKind.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, ids]) => permutations(ids));

  let best: string | null = null;
  const assignment = new Map<string, number>(fixedIndex);
  const combine = (groupIndex: number, nextSlot: number): void => {
    if (groupIndex === groups.length) {
      const ordered = slotIds.slice(0, usedStart);
      const kinds = slotKinds.slice(0, usedStart);
      for (const [id, slot] of assignment) {
        if (slot >= usedStart) {
          ordered[slot] = id;
          kinds[slot] = usedKinds.get(id)!;
        }
      }
      const key = serialize(
        ordered,
        kinds,
        inputIds.length,
        wires,
        assignment,
      );
      if (best === null || key < best) best = key;
      return;
    }
    for (const perm of groups[groupIndex]) {
      perm.forEach((id, offset) => assignment.set(id, nextSlot + offset));
      combine(groupIndex + 1, nextSlot + perm.length);
    }
  };
  combine(0, usedStart);
  return best ?? "[]";
}

function serialize(
  slotIds: readonly string[],
  slotKinds: readonly (GateKind | null)[],
  inputCount: number,
  wires: readonly CanonWire[],
  assignment: ReadonlyMap<string, number>,
): string {
  const incoming: number[][] = slotIds.map(() => []);
  for (const wire of wires) {
    const to = assignment.get(wire.toId);
    const from = assignment.get(wire.fromId);
    if (to === undefined || from === undefined) continue;
    incoming[to].push(from);
  }
  const parts = slotIds.map((_, index) => {
    const kind = slotKinds[index];
    if (kind === null)
      return index < inputCount ? "I" : `O${incoming[index].join(",")}`;
    const sources = incoming[index];
    if (pinsCommutative(kind)) sources.sort((a, b) => a - b);
    return `${kind}:${sources.join(",")}`;
  });
  return `[${parts.join("|")}]`;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const result: T[][] = [];
  const used = new Array(items.length).fill(false);
  const current: T[] = [];
  const walk = () => {
    if (current.length === items.length) {
      result.push(current.slice());
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      current.push(items[i]);
      walk();
      current.pop();
      used[i] = false;
    }
  };
  walk();
  return result;
}
