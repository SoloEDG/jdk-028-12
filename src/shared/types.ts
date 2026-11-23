export type Signal = 0 | 1 | "X";
export type GateKind =
  "INPUT" | "OUTPUT" | "AND" | "OR" | "XOR" | "NOT" | "NAND" | "NOR";
export interface Point {
  x: number;
  y: number;
}
export interface GateNode extends Point {
  id: string;
  kind: GateKind;
  label: string;
  value: 0 | 1;
  /** 谜题固定部分：学生不可移动、删除或改接 */
  fixed?: boolean;
}
export interface Endpoint {
  nodeId: string;
  port: number;
}
export interface Wire {
  id: string;
  from: Endpoint;
  to: Endpoint;
  /** 谜题固定连线：学生不可拆除 */
  fixed?: boolean;
}
export interface CircuitDocument {
  version: 1 | 2;
  name: string;
  nodes: GateNode[];
  wires: Wire[];
  targetId: string;
  /** 激活的电路谜题；保存时随实验一起持久化 */
  puzzle?: PuzzleState;
}
export interface GateSpec {
  kind: GateKind;
  name: string;
  symbol: string;
  inputs: number;
  outputs: number;
  description: string;
}
export interface SimulationResult {
  values: Record<string, Signal>;
  pins: Record<string, Signal[]>;
  wires: Record<string, Signal>;
  order: string[];
}

/* ---------- 电路谜题 ---------- */

/** 可参与谜题库存的门类型（不含输入输出端） */
export type PuzzleGateKind = Exclude<GateKind, "INPUT" | "OUTPUT">;
export type Inventory = Partial<Record<PuzzleGateKind, number>>;
/** 生成判定结果 */
export type PuzzleVerdict =
  | "invalid-fixed" // 固定部分已经无解
  | "none" // 搜索完成，无任何结构解
  | "unique" // 结构解唯一
  | "multiple" // 存在多种结构解
  | "unconfirmed"; // 搜索未结束，尚未确认
export interface CircuitSlice {
  nodes: GateNode[];
  wires: Wire[];
}
export interface PuzzleDef {
  /** 随机种子：同一组设置 + 同一种子生成可重现的题目 */
  seed: number;
  inputCount: number;
  outputCount: number;
  /** 学生可用门库存 */
  inventory: Inventory;
  /** 库存中必须全部参与目标输出的门 */
  mustUse: Inventory;
  /** 目标行为：2^inputCount 行，每行 outputCount 个 0/1 */
  target: (0 | 1)[][];
}
export interface PuzzleAnalysis {
  verdict: PuzzleVerdict;
  /** 已确认的不同结构解数量（提前终止时至少为 2） */
  solutions: number;
  /** 已执行的搜索步数 */
  steps: number;
  /** 搜索是否已完整结束 */
  exhausted: boolean;
  message: string;
}
export interface PuzzleState {
  def: PuzzleDef;
  analysis: PuzzleAnalysis;
  /** 留空边界：生成时刻的固定门与固定连线快照（含输入输出端） */
  fixedSnapshot: CircuitSlice;
  /** 教师参考解，只有教师可展开；与学生线路分离存放 */
  solution: CircuitSlice | null;
  /** 教师口令散列（课堂级保护，可为空） */
  teacherCodeHash: string | null;
}
