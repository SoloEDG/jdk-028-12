import type {
  CircuitDocument,
  CircuitSlice,
  GateNode,
  Inventory,
  PuzzleAnalysis,
  PuzzleDef,
  PuzzleGateKind,
  PuzzleState,
  PuzzleVerdict,
  Wire,
} from "@/shared/types";
import { getSpec, gateSpecs } from "@/features/catalog";
import { topologicalOrder } from "@/features/circuit";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const GATE_KINDS = new Set(
  gateSpecs.map((spec) => spec.kind).filter((k) => k !== "INPUT" && k !== "OUTPUT"),
);
const VERDICTS: readonly PuzzleVerdict[] = [
  "invalid-fixed",
  "none",
  "unique",
  "multiple",
  "unconfirmed",
];

function decodeNodes(value: unknown, ids: Set<string>): GateNode[] {
  if (!Array.isArray(value)) throw new Error("元件列表无效");
  return value.map((item) => {
    if (
      !object(item) ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 100 ||
      ids.has(item.id) ||
      typeof item.kind !== "string" ||
      typeof item.label !== "string" ||
      item.label.length > 40 ||
      !Number.isFinite(item.x) ||
      !Number.isFinite(item.y) ||
      (item.value !== 0 && item.value !== 1) ||
      (item.fixed !== undefined && item.fixed !== true)
    )
      throw new Error("元件内容无效或编号重复");
    const spec = getSpec(item.kind);
    ids.add(item.id);
    if (
      Number(item.x) < 20 ||
      Number(item.x) > 880 ||
      Number(item.y) < 40 ||
      Number(item.y) > 420
    )
      throw new Error("元件坐标超出工作台范围");
    return {
      id: item.id,
      kind: spec.kind,
      label: item.label,
      x: Number(item.x),
      y: Number(item.y),
      value: item.value,
      ...(item.fixed === true ? { fixed: true } : {}),
    };
  });
}

function decodeWires(
  value: unknown,
  nodes: GateNode[],
  ids: Set<string>,
): Wire[] {
  if (!Array.isArray(value)) throw new Error("连线列表无效");
  const wireIds = new Set<string>(),
    occupied = new Set<string>();
  return value.map((item) => {
    if (
      !object(item) ||
      typeof item.id !== "string" ||
      !item.id ||
      ids.has(item.id) ||
      wireIds.has(item.id) ||
      !object(item.from) ||
      !object(item.to) ||
      (item.fixed !== undefined && item.fixed !== true)
    )
      throw new Error("连线内容无效或编号重复");
    const fromRef = item.from,
      toRef = item.to;
    const from = nodes.find((n) => n.id === fromRef.nodeId),
      to = nodes.find((n) => n.id === toRef.nodeId);
    const fp = fromRef.port,
      tp = toRef.port;
    if (
      !from ||
      !to ||
      from === to ||
      !Number.isInteger(fp) ||
      !Number.isInteger(tp) ||
      Number(fp) < 0 ||
      Number(fp) >= getSpec(from.kind).outputs ||
      Number(tp) < 0 ||
      Number(tp) >= getSpec(to.kind).inputs
    )
      throw new Error("连线引用了无效端口");
    const key = `${to.id}:${tp}`;
    if (occupied.has(key)) throw new Error("同一输入端口不能连接两个输出");
    occupied.add(key);
    wireIds.add(item.id);
    return {
      id: item.id,
      from: { nodeId: from.id, port: Number(fp) },
      to: { nodeId: to.id, port: Number(tp) },
      ...(item.fixed === true ? { fixed: true } : {}),
    };
  });
}

function decodeSlice(
  value: unknown,
  name: string,
  extraNodes: GateNode[] = [],
): CircuitSlice {
  if (!object(value)) throw new Error(`谜题的${name}无效`);
  const ids = new Set<string>(extraNodes.map((n) => n.id));
  const nodes = decodeNodes(value.nodes, ids);
  // 连线可以引用切片之外的固定节点（如参考解接到固定端口）
  const wires = decodeWires(value.wires, [...nodes, ...extraNodes], ids);
  if (nodes.length > 120 || wires.length > 480)
    throw new Error(`谜题的${name}超出规模上限`);
  return { nodes, wires };
}

function decodeInventory(value: unknown, name: string): Inventory {
  if (!object(value)) throw new Error(`谜题${name}无效`);
  const result: Inventory = {};
  for (const [kind, count] of Object.entries(value)) {
    if (
      !GATE_KINDS.has(kind as PuzzleGateKind) ||
      !Number.isInteger(count) ||
      (count as number) < 0 ||
      (count as number) > 6
    )
      throw new Error(`谜题${name}无效`);
    if ((count as number) > 0)
      result[kind as PuzzleGateKind] = count as number;
  }
  return result;
}

function decodeDef(value: unknown): PuzzleDef {
  if (
    !object(value) ||
    !Number.isInteger(value.seed) ||
    Number(value.seed) < 1 ||
    !Number.isInteger(value.inputCount) ||
    Number(value.inputCount) < 1 ||
    Number(value.inputCount) > 4 ||
    !Number.isInteger(value.outputCount) ||
    Number(value.outputCount) < 1 ||
    Number(value.outputCount) > 2
  )
    throw new Error("谜题定义无效");
  const inputCount = Number(value.inputCount),
    outputCount = Number(value.outputCount);
  const inventory = decodeInventory(value.inventory, "库存");
  const mustUse = decodeInventory(value.mustUse ?? {}, "必用设置");
  for (const [kind, count] of Object.entries(mustUse) as [
    PuzzleGateKind,
    number,
  ][])
    if (count > (inventory[kind] ?? 0))
      throw new Error("必用数量不能超过库存");
  if (!Array.isArray(value.target) || value.target.length !== 1 << inputCount)
    throw new Error("谜题目标真值表行数不正确");
  const target = value.target.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== outputCount ||
      !row.every((bit) => bit === 0 || bit === 1)
    )
      throw new Error("谜题目标真值表内容无效");
    return [...row] as (0 | 1)[];
  });
  return {
    seed: Number(value.seed),
    inputCount,
    outputCount,
    inventory,
    mustUse,
    target,
  };
}

function decodeAnalysis(value: unknown): PuzzleAnalysis {
  if (
    !object(value) ||
    !VERDICTS.includes(value.verdict as PuzzleVerdict) ||
    !Number.isInteger(value.solutions) ||
    !Number.isInteger(value.steps) ||
    typeof value.exhausted !== "boolean" ||
    typeof value.message !== "string" ||
    value.message.length > 200
  )
    throw new Error("谜题分析结果无效");
  return {
    verdict: value.verdict as PuzzleVerdict,
    solutions: Number(value.solutions),
    steps: Number(value.steps),
    exhausted: value.exhausted,
    message: value.message,
  };
}

function decodePuzzle(value: unknown): PuzzleState {
  if (!object(value)) throw new Error("谜题数据无效");
  const def = decodeDef(value.def);
  const analysis = decodeAnalysis(value.analysis);
  const fixedSnapshot = decodeSlice(value.fixedSnapshot, "固定部分");
  const inputs = fixedSnapshot.nodes.filter((n) => n.kind === "INPUT").length;
  const outputs = fixedSnapshot.nodes.filter((n) => n.kind === "OUTPUT").length;
  if (inputs !== def.inputCount || outputs !== def.outputCount)
    throw new Error("谜题固定端口与定义不一致");
  if (
    !fixedSnapshot.nodes.every((n) => n.fixed) ||
    !fixedSnapshot.wires.every((w) => w.fixed)
  )
    throw new Error("谜题固定部分缺少固定标记");
  const solution =
    value.solution === null
      ? null
      : decodeSlice(value.solution, "参考解", fixedSnapshot.nodes);
  if (
    value.teacherCodeHash !== null &&
    typeof value.teacherCodeHash !== "string"
  )
    throw new Error("谜题教师口令数据无效");
  return {
    def,
    analysis,
    fixedSnapshot,
    solution,
    teacherCodeHash:
      typeof value.teacherCodeHash === "string" ? value.teacherCodeHash : null,
  };
}

export function decodeDocument(text: string): CircuitDocument {
  if (text.length > 2_000_000)
    throw new Error("实验文件超过 2 MB，请缩小后再导入");
  const data: unknown = JSON.parse(text);
  if (
    !object(data) ||
    (data.version !== 1 && data.version !== 2) ||
    typeof data.name !== "string" ||
    data.name.length > 80 ||
    !["xor", "and", "or"].includes(String(data.targetId)) ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.wires)
  )
    throw new Error("文件格式或版本不受支持");
  if (data.nodes.length > 120 || data.wires.length > 480)
    throw new Error("实验最多支持 120 个元件、480 条连线");
  const ids = new Set<string>();
  const nodes = decodeNodes(data.nodes, ids);
  const wires = decodeWires(data.wires, nodes, ids);
  const puzzle = data.version === 2 ? decodePuzzle(data.puzzle) : undefined;
  const document: CircuitDocument = {
    version: puzzle ? 2 : 1,
    name: data.name,
    targetId: String(data.targetId),
    nodes,
    wires,
    ...(puzzle ? { puzzle } : {}),
  };
  topologicalOrder(document);
  return document;
}
export function encodeDocument(document: CircuitDocument): string {
  return JSON.stringify(
    { ...document, version: document.puzzle ? 2 : 1 },
    null,
    2,
  );
}
