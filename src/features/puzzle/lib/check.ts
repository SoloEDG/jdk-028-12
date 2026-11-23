import type {
  CircuitDocument,
  PuzzleGateKind,
  PuzzleState,
  Signal,
} from "@/shared/types";
import { getSpec } from "../../catalog/lib/specs";
import { evaluate } from "../../simulation/lib/evaluate";

export interface BehaviorRow {
  inputs: (0 | 1)[];
  expected: (0 | 1)[];
  actual: Signal[];
  matches: boolean;
}
export interface CheckResult {
  fixedViolations: string[];
  inventoryViolations: string[];
  wiringViolations: string[];
  rows: BehaviorRow[];
  behaviorError: string | null;
  passed: boolean;
}

const GATE_KINDS: readonly PuzzleGateKind[] = [
  "AND",
  "OR",
  "XOR",
  "NOT",
  "NAND",
  "NOR",
];

/**
 * 学生作答检测：只核对行为、库存、固定边界与接线完整性，
 * 绝不拿学生线路与教师解的元件编号做比对。
 */
export function checkStudent(
  document: CircuitDocument,
  puzzle: PuzzleState,
): CheckResult {
  const fixedViolations: string[] = [];
  const inventoryViolations: string[] = [];
  const wiringViolations: string[] = [];
  const snapshot = puzzle.fixedSnapshot;

  // ---- 固定边界 ----
  for (const fixedNode of snapshot.nodes) {
    const current = document.nodes.find((n) => n.id === fixedNode.id);
    if (!current) {
      fixedViolations.push(`固定的 ${fixedNode.label} 被删除`);
      continue;
    }
    if (current.kind !== fixedNode.kind)
      fixedViolations.push(`固定的 ${fixedNode.label} 类型被改动`);
    if (current.x !== fixedNode.x || current.y !== fixedNode.y)
      fixedViolations.push(`固定的 ${fixedNode.label} 被移动`);
    if (
      (current.kind === "INPUT" || current.kind === "OUTPUT") &&
      current.label !== fixedNode.label
    )
      fixedViolations.push(`固定端口 ${fixedNode.label} 被改名`);
  }
  for (const fixedWire of snapshot.wires) {
    const alive = document.wires.some(
      (w) =>
        w.from.nodeId === fixedWire.from.nodeId &&
        w.from.port === fixedWire.from.port &&
        w.to.nodeId === fixedWire.to.nodeId &&
        w.to.port === fixedWire.to.port,
    );
    if (!alive) {
      const from = snapshot.nodes.find((n) => n.id === fixedWire.from.nodeId);
      const to = snapshot.nodes.find((n) => n.id === fixedWire.to.nodeId);
      fixedViolations.push(
        `固定连线 ${from?.label ?? "?"} → ${to?.label ?? "?"} 被拆除`,
      );
    }
  }
  // 快照之外不允许出现新的“固定”标记（防止篡改存档绕过库存）
  const snapshotNodeIds = new Set(snapshot.nodes.map((n) => n.id));
  for (const node of document.nodes)
    if (node.fixed && !snapshotNodeIds.has(node.id))
      fixedViolations.push(`${node.label} 被非法标记为固定元件`);
  const snapshotWireKeys = new Set(
    snapshot.wires.map(
      (w) => `${w.from.nodeId}:${w.from.port}>${w.to.nodeId}:${w.to.port}`,
    ),
  );
  for (const wire of document.wires)
    if (
      wire.fixed &&
      !snapshotWireKeys.has(
        `${wire.from.nodeId}:${wire.from.port}>${wire.to.nodeId}:${wire.to.port}`,
      )
    )
      fixedViolations.push("存在快照之外的固定连线");

  // ---- 库存 ----
  const studentNodes = document.nodes.filter((n) => !n.fixed);
  const ioNodes = studentNodes.filter(
    (n) => n.kind === "INPUT" || n.kind === "OUTPUT",
  );
  if (ioNodes.length)
    inventoryViolations.push(
      `不允许自行添加输入/输出端（多出 ${ioNodes.length} 个）`,
    );
  for (const kind of GATE_KINDS) {
    const used = studentNodes.filter((n) => n.kind === kind).length;
    const allowed = puzzle.def.inventory[kind] ?? 0;
    const required = puzzle.def.mustUse[kind] ?? 0;
    if (used > allowed)
      inventoryViolations.push(`${kind} 使用 ${used} 个，超出库存 ${allowed} 个`);
    if (used < required)
      inventoryViolations.push(
        `必用门 ${kind} 至少使用 ${required} 个，当前 ${used} 个`,
      );
  }

  // ---- 接线完整性：未连接的输入脚 ----
  const nodeById = new Map(document.nodes.map((n) => [n.id, n]));
  for (const node of document.nodes) {
    const spec = getSpec(node.kind);
    for (let port = 0; port < spec.inputs; port++) {
      const wired = document.wires.some(
        (w) => w.to.nodeId === node.id && w.to.port === port,
      );
      if (!wired)
        wiringViolations.push(
          `${node.label} 的输入脚 ${port + 1} 未接线`,
        );
    }
  }

  // ---- 悬挂门：所有门都必须参与目标输出 ----
  const outputIds = snapshot.nodes
    .filter((n) => n.kind === "OUTPUT")
    .map((n) => n.id);
  const reachable = new Set<string>(outputIds);
  const stack = [...outputIds];
  while (stack.length) {
    const id = stack.pop()!;
    for (const wire of document.wires)
      if (wire.to.nodeId === id && !reachable.has(wire.from.nodeId)) {
        reachable.add(wire.from.nodeId);
        stack.push(wire.from.nodeId);
      }
  }
  for (const node of document.nodes) {
    if (node.kind === "INPUT" || node.kind === "OUTPUT") continue;
    if (!reachable.has(node.id))
      wiringViolations.push(`${node.label} 是未参与任何输出的悬挂门`);
  }

  // ---- 行为 ----
  const rows: BehaviorRow[] = [];
  let behaviorError: string | null = null;
  const inputNodes = snapshot.nodes.filter((n) => n.kind === "INPUT");
  const outputNodes = snapshot.nodes.filter((n) => n.kind === "OUTPUT");
  const missingIo = [...inputNodes, ...outputNodes].some(
    (n) => !nodeById.has(n.id),
  );
  if (missingIo) {
    behaviorError = "固定的输入/输出端缺失，无法核对行为";
  } else {
    const rowCount = 1 << puzzle.def.inputCount;
    try {
      for (let row = 0; row < rowCount; row++) {
        const inputs = inputNodes.map(
          (_, i) => ((row >> (puzzle.def.inputCount - 1 - i)) & 1) as 0 | 1,
        );
        const overrides: Record<string, 0 | 1> = {};
        inputNodes.forEach((node, i) => (overrides[node.id] = inputs[i]));
        const result = evaluate(document, overrides);
        const actual = outputNodes.map(
          (node) => result.values[node.id] ?? "X",
        );
        const expected = puzzle.def.target[row];
        rows.push({
          inputs,
          expected,
          actual,
          matches: actual.every((value, j) => value === expected[j]),
        });
      }
    } catch {
      behaviorError = "电路存在无效连线或反馈环，无法核对行为";
      rows.length = 0;
    }
  }

  const passed =
    !fixedViolations.length &&
    !inventoryViolations.length &&
    !wiringViolations.length &&
    !behaviorError &&
    rows.every((row) => row.matches);
  return {
    fixedViolations,
    inventoryViolations,
    wiringViolations,
    rows,
    behaviorError,
    passed,
  };
}
