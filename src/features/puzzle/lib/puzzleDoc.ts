import type {
  CircuitDocument,
  CircuitSlice,
  GateNode,
  Inventory,
  PuzzleGateKind,
} from "@/shared/types";
import { createRng, randomInt } from "./bits";

export const INPUT_LABELS = ["A", "B", "C", "D"] as const;
export const OUTPUT_LABELS = ["Y", "Y2"] as const;

/** 按输入/输出数量创建固定端口（位置可重现，不用随机） */
export function createIoNodes(
  inputCount: number,
  outputCount: number,
): GateNode[] {
  const nodes: GateNode[] = [];
  for (let i = 0; i < inputCount; i++)
    nodes.push({
      id: `pz-in-${i}`,
      kind: "INPUT",
      label: INPUT_LABELS[i] ?? `I${i + 1}`,
      value: 0,
      fixed: true,
      x: 60,
      y: snap(120 + i * 120),
    });
  for (let j = 0; j < outputCount; j++)
    nodes.push({
      id: `pz-out-${j}`,
      kind: "OUTPUT",
      label: OUTPUT_LABELS[j] ?? `Y${j + 1}`,
      value: 0,
      fixed: true,
      x: 820,
      y: snap(160 + j * 140),
    });
  return nodes;
}
const snap = (value: number) => Math.round(value / 20) * 20;

/** 提取当前文档中的固定部分快照（留空边界） */
export function fixedSnapshotOf(document: CircuitDocument): CircuitSlice {
  return {
    nodes: document.nodes
      .filter((n) => n.fixed)
      .map((n) => ({ ...n })),
    wires: document.wires
      .filter((w) => w.fixed)
      .map((w) => ({ ...w, from: { ...w.from }, to: { ...w.to } })),
  };
}

/** 统计学生已放置的库存门数量（非固定、非端口） */
export function usedInventory(
  document: CircuitDocument,
): Partial<Record<PuzzleGateKind, number>> {
  const used: Partial<Record<PuzzleGateKind, number>> = {};
  for (const node of document.nodes) {
    if (node.fixed || node.kind === "INPUT" || node.kind === "OUTPUT")
      continue;
    used[node.kind] = (used[node.kind] ?? 0) + 1;
  }
  return used;
}

/** 剩余库存 */
export function remainingInventory(
  inventory: Inventory,
  used: Partial<Record<PuzzleGateKind, number>>,
): Inventory {
  const remaining: Inventory = {};
  for (const kind of Object.keys(inventory) as PuzzleGateKind[]) {
    remaining[kind] = Math.max(0, (inventory[kind] ?? 0) - (used[kind] ?? 0));
  }
  return remaining;
}

/** 用种子生成随机目标行为（每列保证既有 0 也有 1），可重现 */
export function randomTarget(
  seed: number,
  inputCount: number,
  outputCount: number,
): (0 | 1)[][] {
  const rng = createRng(seed);
  const rows = 1 << inputCount;
  const target: (0 | 1)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: outputCount }, () => 0 as 0 | 1),
  );
  for (let j = 0; j < outputCount; j++) {
    let column: (0 | 1)[];
    do {
      column = Array.from({ length: rows }, () => randomInt(rng, 2) as 0 | 1);
    } while (column.every((v) => v === column[0]));
    column.forEach((value, row) => (target[row][j] = value));
  }
  return target;
}

/** 空目标（全 0），供教师手动编辑 */
export function blankTarget(
  inputCount: number,
  outputCount: number,
): (0 | 1)[][] {
  return Array.from({ length: 1 << inputCount }, () =>
    Array.from({ length: outputCount }, () => 0 as 0 | 1),
  );
}
