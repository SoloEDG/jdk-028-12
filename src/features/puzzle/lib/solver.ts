import type {
  Endpoint,
  GateKind,
  GateNode,
  Inventory,
  PuzzleAnalysis,
  PuzzleGateKind,
  PuzzleVerdict,
  Wire,
} from "@/shared/types";
import { getSpec } from "../../catalog/lib/specs";
import { canonicalKey, pinsCommutative } from "./canon";
import { fullMask, inputMask, targetMask } from "./bits";

/** 求解规模上限：课堂级谜题，超出请拆分 */
export const SOLVER_LIMITS = {
  maxInputs: 4,
  maxOutputs: 2,
  maxPerKind: 6,
  maxTotalGates: 8,
} as const;
export const BUDGET_OPTIONS = [
  { label: "快速（50 万步）", value: 500_000 },
  { label: "标准（300 万步）", value: 3_000_000 },
  { label: "深度（1000 万步）", value: 10_000_000 },
] as const;

export interface RawWire {
  from: Endpoint;
  to: Endpoint;
}
export interface RawSolution {
  /** 本次用掉的库存门（固定门与输入输出端不在其中） */
  gates: { id: string; kind: GateKind }[];
  /** 固定连线之外的全部连线 */
  wires: RawWire[];
}
export interface SolveInput {
  inputCount: number;
  outputCount: number;
  inventory: Inventory;
  mustUse: Inventory;
  target: (0 | 1)[][];
  /** 固定部分：输入输出端 + 固定门 */
  fixedNodes: GateNode[];
  fixedWires: Wire[];
  budget: number;
  onProgress?: (steps: number) => void;
}
export interface SolveResult {
  analysis: PuzzleAnalysis;
  /** 已确认的不同结构解（至多 2 个即停止） */
  solutions: RawSolution[];
}

const GATE_KINDS: readonly PuzzleGateKind[] = [
  "AND",
  "OR",
  "XOR",
  "NOT",
  "NAND",
  "NOR",
];

function evalMask(kind: GateKind, pins: number[], full: number): number {
  switch (kind) {
    case "AND":
      return pins[0] & pins[1];
    case "NAND":
      return ~(pins[0] & pins[1]) & full;
    case "OR":
      return pins[0] | pins[1];
    case "NOR":
      return ~(pins[0] | pins[1]) & full;
    case "XOR":
      return pins[0] ^ pins[1];
    case "NOT":
      return ~pins[0] & full;
    default:
      return 0;
  }
}

interface FixedGate {
  id: string;
  kind: GateKind;
  /** 每个输入脚：已被固定连线占用时的来源节点 id */
  fixedPins: (string | null)[];
  /** 通过固定连线依赖的固定门 */
  preds: string[];
}

class Halt {
  readonly reason: "budget" | "multiple";
  constructor(reason: "budget" | "multiple") {
    this.reason = reason;
  }
}

export async function solvePuzzle(input: SolveInput): Promise<SolveResult> {
  const stepsBox = { count: 0 };
  const progress = input.onProgress ?? (() => {});
  const inputs = input.fixedNodes.filter((n) => n.kind === "INPUT");
  const outputs = input.fixedNodes.filter((n) => n.kind === "OUTPUT");
  const fixedGates = input.fixedNodes.filter(
    (n) => n.kind !== "INPUT" && n.kind !== "OUTPUT",
  );

  const invalid = validateFixed(input, inputs, outputs);
  if (invalid)
    return {
      analysis: {
        verdict: "invalid-fixed",
        solutions: 0,
        steps: 0,
        exhausted: true,
        message: invalid,
      },
      solutions: [],
    };

  const rowCount = 1 << input.inputCount;
  const full = fullMask(rowCount);
  const inputIds = inputs.map((n) => n.id);
  const outputIds = outputs.map((n) => n.id);
  const masks = inputs.map((_, i) => inputMask(input.inputCount, i));
  const sourceIds = [...inputIds];
  const maskById = new Map<string, number>();
  inputIds.forEach((id, i) => maskById.set(id, masks[i]));
  const targetMasks = Array.from({ length: input.outputCount }, (_, j) =>
    targetMask(input.target, j),
  );

  // 固定部分已经强制某个输出时的预检：完全由固定部分决定的输出若与目标矛盾，直接判定
  const forced = forcedOutputConflict(
    input,
    inputs,
    outputs,
    fixedGates,
    targetMasks,
    full,
  );
  if (forced)
    return {
      analysis: {
        verdict: "invalid-fixed",
        solutions: 0,
        steps: 0,
        exhausted: true,
        message: forced,
      },
      solutions: [],
    };

  const gateSpecs = fixedGates.map((node) => ({
    id: node.id,
    kind: node.kind,
    fixedPins: Array.from(
      { length: getSpec(node.kind).inputs },
      (_, port) =>
        input.fixedWires.find((w) => w.to.nodeId === node.id && w.to.port === port)
          ?.from.nodeId ?? null,
    ),
    preds: [
      ...new Set(
        input.fixedWires
          .filter((w) => w.to.nodeId === node.id)
          .map((w) => w.from.nodeId)
          .filter((id) => fixedGates.some((g) => g.id === id)),
      ),
    ],
  }));
  const outputFixedSource: (string | null)[] = outputs.map(
    (out) =>
      input.fixedWires.find((w) => w.to.nodeId === out.id && w.to.port === 0)
        ?.from.nodeId ?? null,
  );

  const seen = new Set<string>();
  const solutions: RawSolution[] = [];
  let exhausted = true;

  // 库存用量向量：每种门 [必用 .. 库存]
  const kinds = GATE_KINDS.filter((k) => (input.inventory[k] ?? 0) > 0);
  const vectors: Partial<Record<GateKind, number>>[] = [];
  const buildVectors = (index: number, current: Partial<Record<GateKind, number>>) => {
    if (index === kinds.length) {
      const total =
        Object.values(current).reduce((a, b) => a + b, 0) + fixedGates.length;
      if (total <= SOLVER_LIMITS.maxTotalGates) vectors.push({ ...current });
      return;
    }
    const kind = kinds[index];
    const lo = Math.min(input.mustUse[kind] ?? 0, input.inventory[kind] ?? 0);
    for (let count = lo; count <= (input.inventory[kind] ?? 0); count++) {
      current[kind] = count;
      buildVectors(index + 1, current);
    }
    delete current[kind];
  };
  buildVectors(0, {});

  const placedIds: string[] = [];
  const placedKinds: GateKind[] = [];
  const placedSources: number[][] = [];
  const placedFixed = new Set<string>();

  const recordSolutions = (
    outputChoices: number[][],
  ): void => {
    // 输出接法组合笛卡尔积
    const combos: number[][] = [[]];
    for (const choices of outputChoices) {
      const next: number[][] = [];
      for (const combo of combos)
        for (const choice of choices) next.push([...combo, choice]);
      combos.length = 0;
      combos.push(...next);
    }
    for (const combo of combos) {
      stepsBox.count++;
      const wires: RawWire[] = [];
      placedIds.forEach((id, depth) => {
        const spec = getSpec(placedKinds[depth]);
        const freePorts: number[] = [];
        const fixedGate = gateSpecs.find((g) => g.id === id);
        for (let port = 0; port < spec.inputs; port++) {
          if (fixedGate && fixedGate.fixedPins[port] !== null) continue;
          freePorts.push(port);
        }
        freePorts.forEach((port, i) =>
          wires.push({
            from: { nodeId: sourceIds[placedSources[depth][i]], port: 0 },
            to: { nodeId: id, port },
          }),
        );
      });
      combo.forEach((sourceIndex, j) => {
        // 输出脚已被固定连线占用时，该线属于固定部分，不重复计入解
        if (sourceIndex < 0) return;
        wires.push({
          from: { nodeId: sourceIds[sourceIndex], port: 0 },
          to: { nodeId: outputIds[j], port: 0 },
        });
      });
      if (!allUseful(wires, input, placedIds, gateSpecs, outputIds)) continue;
      const key = canonicalKey(
        inputIds,
        outputIds,
        gateSpecs.map((g) => ({ id: g.id, kind: g.kind })),
        placedIds
          .filter((id) => !placedFixed.has(id))
          .map((id, ) => ({
            id,
            kind: placedKinds[placedIds.indexOf(id)],
          })),
        [
          ...input.fixedWires.map((w) => ({
            fromId: w.from.nodeId,
            toId: w.to.nodeId,
            toPort: w.to.port,
          })),
          ...wires.map((w) => ({
            fromId: w.from.nodeId,
            toId: w.to.nodeId,
            toPort: w.to.port,
          })),
        ],
      );
      if (seen.has(key)) continue;
      seen.add(key);
      solutions.push({
        gates: placedIds
          .filter((id) => !placedFixed.has(id))
          .map((id) => ({
            id,
            kind: placedKinds[placedIds.indexOf(id)],
          })),
        wires,
      });
      if (solutions.length >= 2) throw new Halt("multiple");
    }
  };

  const finish = (): void => {
    const outputChoices: number[][] = [];
    for (let j = 0; j < outputs.length; j++) {
      const forced = outputFixedSource[j];
      if (forced !== null) {
        if (maskById.get(forced) !== targetMasks[j]) return;
        outputChoices.push([-1]); // 固定输出：只校验，不再生成连线
        continue;
      }
      const choices: number[] = [];
      for (let s = 0; s < sourceIds.length; s++)
        if (masks[s] === targetMasks[j]) choices.push(s);
      if (!choices.length) return;
      outputChoices.push(choices);
    }
    recordSolutions(outputChoices);
  };

  interface Option {
    fixedId: string | null;
    kind: GateKind;
    sources: number[];
  }
  const buildOptions = (): Option[] => {
    const options: Option[] = [];
    const sourceCount = sourceIds.length;
    const pushCombos = (
      fixedId: string | null,
      kind: GateKind,
      freePorts: number,
    ) => {
      if (freePorts === 0) {
        options.push({ fixedId, kind, sources: [] });
        return;
      }
      if (freePorts === 1) {
        for (let s = 0; s < sourceCount; s++)
          options.push({ fixedId, kind, sources: [s] });
        return;
      }
      // 两个自由脚：可交换门只枚举有序对，剪掉输入脚互换的重复
      if (pinsCommutative(kind)) {
        for (let a = 0; a < sourceCount; a++)
          for (let b = a; b < sourceCount; b++)
            options.push({ fixedId, kind, sources: [a, b] });
      } else {
        for (let a = 0; a < sourceCount; a++)
          for (let b = 0; b < sourceCount; b++)
            options.push({ fixedId, kind, sources: [a, b] });
      }
    };
    for (const [kind, left] of remaining)
      if (left > 0) pushCombos(null, kind, getSpec(kind).inputs);
    for (const gate of gateSpecs) {
      if (placedFixed.has(gate.id)) continue;
      if (!gate.preds.every((p) => placedFixed.has(p))) continue;
      pushCombos(
        gate.id,
        gate.kind,
        gate.fixedPins.filter((p) => p === null).length,
      );
    }
    return options;
  };

  const remaining = new Map<GateKind, number>();
  const apply = (option: Option): void => {
    const id = option.fixedId ?? `u${placedIds.length}`;
    const spec = getSpec(option.kind);
    const pinMasks: number[] = [];
    let free = 0;
    const fixedGate = option.fixedId
      ? gateSpecs.find((g) => g.id === option.fixedId)!
      : null;
    for (let port = 0; port < spec.inputs; port++) {
      const fixedSource = fixedGate?.fixedPins[port] ?? null;
      pinMasks.push(
        fixedSource !== null
          ? maskById.get(fixedSource)!
          : masks[option.sources[free++]],
      );
    }
    const mask = evalMask(option.kind, pinMasks, full);
    placedIds.push(id);
    placedKinds.push(option.kind);
    placedSources.push(option.sources);
    masks.push(mask);
    sourceIds.push(id);
    maskById.set(id, mask);
    if (option.fixedId) placedFixed.add(option.fixedId);
    else remaining.set(option.kind, remaining.get(option.kind)! - 1);
  };
  const undo = (option: Option): void => {
    const id = placedIds.pop()!;
    placedKinds.pop();
    placedSources.pop();
    masks.pop();
    sourceIds.pop();
    maskById.delete(id);
    if (option.fixedId) placedFixed.delete(option.fixedId);
    else remaining.set(option.kind, remaining.get(option.kind)! + 1);
  };

  try {
    for (const vector of vectors) {
      remaining.clear();
      for (const kind of kinds) remaining.set(kind, vector[kind] ?? 0);
      const totalGates =
        Object.values(vector).reduce((a, b) => a + b, 0) + gateSpecs.length;
      // 没有门可用时，输出只能直接接输入，也要判定
      if (totalGates === 0) {
        finish();
        continue;
      }
      // 迭代式 deepening：显式栈，支持时间片让出
      interface Frame {
        options: Option[];
        next: number;
        applied: Option | null;
      }
      const stack: Frame[] = [
        { options: buildOptions(), next: 0, applied: null },
      ];
      let sinceYield = 0;
      while (stack.length) {
        if (stepsBox.count > input.budget) throw new Halt("budget");
        if (sinceYield >= 65_536) {
          sinceYield = 0;
          progress(stepsBox.count);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const top = stack[stack.length - 1];
        if (top.next >= top.options.length) {
          if (top.applied) undo(top.applied);
          stack.pop();
          continue;
        }
        const option = top.options[top.next++];
        stepsBox.count++;
        sinceYield++;
        apply(option);
        if (placedIds.length === totalGates) {
          finish();
          undo(option);
        } else {
          stack.push({ options: buildOptions(), next: 0, applied: option });
        }
      }
    }
  } catch (error) {
    if (error instanceof Halt) {
      if (error.reason === "budget") exhausted = false;
      // multiple：提前确认多解，搜索无需继续
    } else throw error;
  }

  const found = solutions.length;
  const verdict: PuzzleVerdict =
    found >= 2 ? "multiple" : !exhausted ? "unconfirmed" : found === 1 ? "unique" : "none";
  const messages: Record<PuzzleVerdict, string> = {
    "invalid-fixed": "固定部分已经无解",
    none: "无解：当前库存与固定条件下没有任何接法满足目标行为",
    unique:
      "唯一解：排除同种门编号交换与可交换输入脚互换后，只有一种结构解",
    multiple: `多解：至少存在 ${found} 种结构不同的接法（真值表相同也不算同一解）`,
    unconfirmed: `尚未确认：搜索预算用尽，已找到 ${found} 种结构解，不能断定唯一或无解`,
  };
  return {
    analysis: {
      verdict,
      solutions: found,
      steps: stepsBox.count,
      exhausted,
      message: messages[verdict],
    },
    solutions,
  };
}

/** 固定连线自身是否合法：引用、端口、占位、环路 */
function validateFixed(
  input: SolveInput,
  inputs: GateNode[],
  outputs: GateNode[],
): string | null {
  if (inputs.length !== input.inputCount)
    return `固定部分需要恰好 ${input.inputCount} 个输入端，当前 ${inputs.length} 个`;
  if (outputs.length !== input.outputCount)
    return `固定部分需要恰好 ${input.outputCount} 个输出端，当前 ${outputs.length} 个`;
  const ids = new Set(input.fixedNodes.map((n) => n.id));
  const occupied = new Set<string>();
  const incoming = new Map<string, string[]>();
  for (const wire of input.fixedWires) {
    const from = input.fixedNodes.find((n) => n.id === wire.from.nodeId);
    const to = input.fixedNodes.find((n) => n.id === wire.to.nodeId);
    if (!from || !to)
      return "固定连线引用了固定部分之外的元件，请重新标记固定部分";
    if (from.id === to.id) return "固定连线存在自环";
    if (
      wire.from.port !== 0 ||
      wire.to.port < 0 ||
      wire.to.port >= getSpec(to.kind).inputs
    )
      return "固定连线引用了无效端口";
    const key = `${to.id}:${wire.to.port}`;
    if (occupied.has(key)) return "同一输入脚被两条固定连线占用";
    occupied.add(key);
    const list = incoming.get(wire.to.nodeId) ?? [];
    list.push(wire.from.nodeId);
    incoming.set(wire.to.nodeId, list);
  }
  // 固定连线自身的环检测
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const next of incoming.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    done.add(id);
    return false;
  };
  for (const id of ids) if (visit(id)) return "固定连线已经形成反馈环，固定部分无解";
  return null;
}

/** 完全由固定部分决定的输出若与目标矛盾，则固定部分已经无解 */
function forcedOutputConflict(
  input: SolveInput,
  inputs: GateNode[],
  outputs: GateNode[],
  fixedGates: GateNode[],
  targetMasks: number[],
  full: number,
): string | null {
  const maskById = new Map<string, number>();
  inputs.forEach((_, i) => maskById.set(_.id, inputMask(input.inputCount, i)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const gate of fixedGates) {
      if (maskById.has(gate.id)) continue;
      const spec = getSpec(gate.kind);
      const pins: (number | null)[] = [];
      for (let port = 0; port < spec.inputs; port++) {
        const wire = input.fixedWires.find(
          (w) => w.to.nodeId === gate.id && w.to.port === port,
        );
        pins.push(wire ? (maskById.get(wire.from.nodeId) ?? null) : null);
      }
      if (pins.some((p) => p === null)) continue;
      maskById.set(
        gate.id,
        evalMask(gate.kind, pins as number[], full),
      );
      changed = true;
    }
  }
  for (let j = 0; j < outputs.length; j++) {
    const wire = input.fixedWires.find(
      (w) => w.to.nodeId === outputs[j].id && w.to.port === 0,
    );
    if (!wire) continue;
    const mask = maskById.get(wire.from.nodeId);
    if (mask !== undefined && mask !== targetMasks[j])
      return `固定连线已使输出 ${outputs[j].label} 与目标行为矛盾，固定部分无解`;
  }
  return null;
}

/** 所有库存门与固定门都必须参与目标输出（无悬挂门） */
function allUseful(
  wires: RawWire[],
  input: SolveInput,
  placedIds: string[],
  gateSpecs: FixedGate[],
  outputIds: string[],
): boolean {
  const reachable = new Set<string>(outputIds);
  const stack = [...outputIds];
  const allWires: RawWire[] = [...input.fixedWires, ...wires];
  while (stack.length) {
    const id = stack.pop()!;
    for (const wire of allWires)
      if (wire.to.nodeId === id && !reachable.has(wire.from.nodeId)) {
        reachable.add(wire.from.nodeId);
        stack.push(wire.from.nodeId);
      }
  }
  for (const id of placedIds) if (!reachable.has(id)) return false;
  for (const gate of gateSpecs) if (!reachable.has(gate.id)) return false;
  return true;
}
