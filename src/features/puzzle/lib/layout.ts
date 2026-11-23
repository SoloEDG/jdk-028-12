import type { CircuitSlice, GateNode } from "@/shared/types";
import { createRng, randomInt } from "./bits";
import type { RawSolution } from "./solver";

/** 与主工作台一致的网格 */
const GRID = 20;
const snap = (value: number) => Math.round(value / GRID) * GRID;

/**
 * 把求解结果落成一份可展示的教师解：
 * 固定部分保持原位，库存门按拓扑深度分层排布，
 * 纵向位置由随机种子决定 —— 同种子同设置生成可重现的题目。
 */
export function buildSolutionSlice(
  raw: RawSolution,
  fixedNodes: GateNode[],
  seed: number,
): CircuitSlice {
  const rng = createRng(seed);
  const depth = new Map<string, number>();
  for (const node of fixedNodes) depth.set(node.id, node.kind === "INPUT" ? 0 : 1);
  // 拓扑深度：门的深度 = 1 + 来源最大深度
  const byId = new Map(raw.gates.map((g, i) => [g.id, i]));
  const depths = raw.gates.map(() => 0);
  const incoming = new Map<string, string[]>();
  for (const wire of raw.wires) {
    const list = incoming.get(wire.to.nodeId) ?? [];
    list.push(wire.from.nodeId);
    incoming.set(wire.to.nodeId, list);
  }
  const visit = (id: string): number => {
    const index = byId.get(id);
    if (index === undefined) return depth.get(id) ?? 0;
    if (depths[index] > 0) return depths[index];
    const sources = incoming.get(id) ?? [];
    const value = 1 + Math.max(0, ...sources.map((s) => visit(s)));
    depths[index] = value;
    return value;
  };
  raw.gates.forEach((gate) => visit(gate.id));

  const lanes = new Map<number, number>();
  const nodes: GateNode[] = raw.gates.map((gate, i) => {
    const layer = depths[i];
    const lane = lanes.get(layer) ?? 0;
    lanes.set(layer, lane + 1);
    const jitter = randomInt(rng, 3) - 1; // -1..1，种子决定
    return {
      id: gate.id,
      kind: gate.kind,
      label: `${gate.kind} ${lane + 1}`,
      value: 0 as const,
      x: snap(Math.min(864, 240 + layer * 160)),
      y: snap(Math.max(48, Math.min(412, 108 + lane * 120 + jitter * 20))),
    };
  });
  return {
    nodes,
    wires: raw.wires.map((wire, i) => ({
      id: `sol-w${i}`,
      from: { ...wire.from },
      to: { ...wire.to },
    })),
  };
}
