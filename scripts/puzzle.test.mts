/**
 * 谜题求解器与检测逻辑测试。
 * 运行：node --experimental-strip-types --import ./scripts/register.mjs scripts/puzzle.test.mts
 */
import assert from "node:assert/strict";
import { solvePuzzle, type SolveInput } from "../src/features/puzzle/lib/solver.ts";
import { buildSolutionSlice } from "../src/features/puzzle/lib/layout.ts";
import { checkStudent } from "../src/features/puzzle/lib/check.ts";
import { createIoNodes } from "../src/features/puzzle/lib/puzzleDoc.ts";
import { evaluate } from "../src/features/simulation/lib/evaluate.ts";
import {
  decodeDocument,
  encodeDocument,
} from "../src/features/workspace/lib/codec.ts";
import type {
  CircuitDocument,
  GateNode,
  PuzzleState,
  Wire,
} from "../src/shared/types.ts";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      console.error(`  ✗ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function io(inputCount: number, outputCount: number): GateNode[] {
  return createIoNodes(inputCount, outputCount);
}
function base(partial: Partial<SolveInput>): SolveInput {
  return {
    inputCount: 2,
    outputCount: 1,
    inventory: {},
    mustUse: {},
    target: [[0], [1], [1], [0]],
    fixedNodes: io(2, 1),
    fixedWires: [],
    budget: 3_000_000,
    ...partial,
  };
}
/** 验证解的行为确实复现目标真值表 */
function verifyBehavior(input: SolveInput, raw: {
  gates: { id: string; kind: GateNode["kind"] }[];
  wires: { from: { nodeId: string; port: number }; to: { nodeId: string; port: number } }[];
}) {
  const doc: CircuitDocument = {
    version: 1,
    name: "t",
    targetId: "xor",
    nodes: [
      ...input.fixedNodes.map((n) => ({ ...n })),
      ...raw.gates.map((g, i) => ({
        id: g.id,
        kind: g.kind,
        label: `G${i}`,
        value: 0 as const,
        x: 100,
        y: 100,
      })),
    ],
    wires: [
      ...input.fixedWires,
      ...raw.wires.map((w, i) => ({ id: `w${i}`, from: w.from, to: w.to })),
    ],
  };
  const inputs = input.fixedNodes.filter((n) => n.kind === "INPUT");
  const outputs = input.fixedNodes.filter((n) => n.kind === "OUTPUT");
  for (let row = 0; row < input.target.length; row++) {
    const overrides: Record<string, 0 | 1> = {};
    inputs.forEach(
      (node, i) =>
        (overrides[node.id] = ((row >> (inputs.length - 1 - i)) & 1) as 0 | 1),
    );
    const result = evaluate(doc, overrides);
    outputs.forEach((out, j) => {
      assert.equal(
        result.values[out.id],
        input.target[row][j],
        `第 ${row} 行输出 ${out.label} 应为 ${input.target[row][j]}`,
      );
    });
  }
}

const XOR = [[0], [1], [1], [0]] as (0 | 1)[][];

await test("XOR：OR+NAND+AND 必用 → 唯一结构解，且行为正确", async () => {
  const input = base({
    inventory: { OR: 1, NAND: 1, AND: 1 },
    mustUse: { OR: 1, NAND: 1, AND: 1 },
    target: XOR,
  });
  const result = await solvePuzzle(input);
  assert.equal(result.analysis.verdict, "unique", result.analysis.message);
  assert.equal(result.solutions.length, 1);
  assert.equal(result.solutions[0].gates.length, 3);
  verifyBehavior(input, result.solutions[0]);
});

await test("Y=A：AND×2 可选 → 多种结构解（真值表相同不算同一解）", async () => {
  const result = await solvePuzzle(
    base({ inventory: { AND: 2 }, target: [[0], [0], [1], [1]] }),
  );
  assert.equal(result.analysis.verdict, "multiple", result.analysis.message);
  assert.equal(result.solutions.length, 2);
});

await test("XOR 只有 AND×1 → 无解", async () => {
  const result = await solvePuzzle(base({ inventory: { AND: 1 } }));
  assert.equal(result.analysis.verdict, "none", result.analysis.message);
  assert.equal(result.solutions.length, 0);
});

await test("固定连线成环 → 固定部分已经无解", async () => {
  const gates: GateNode[] = [
    { id: "g1", kind: "AND", label: "G1", value: 0, x: 300, y: 100, fixed: true },
    { id: "g2", kind: "OR", label: "G2", value: 0, x: 500, y: 100, fixed: true },
  ];
  const wires: Wire[] = [
    { id: "w1", from: { nodeId: "g1", port: 0 }, to: { nodeId: "g2", port: 0 }, fixed: true },
    { id: "w2", from: { nodeId: "g2", port: 0 }, to: { nodeId: "g1", port: 0 }, fixed: true },
  ];
  const result = await solvePuzzle(
    base({ fixedNodes: [...io(2, 1), ...gates], fixedWires: wires }),
  );
  assert.equal(result.analysis.verdict, "invalid-fixed");
});

await test("固定连线与目标矛盾 → 固定部分已经无解", async () => {
  const nodes = io(2, 1);
  const wires: Wire[] = [
    { id: "w1", from: { nodeId: "pz-in-0", port: 0 }, to: { nodeId: "pz-out-0", port: 0 }, fixed: true },
  ];
  const result = await solvePuzzle(
    base({ fixedNodes: nodes, fixedWires: wires, target: [[1], [1], [0], [0]] }),
  );
  assert.equal(result.analysis.verdict, "invalid-fixed");
});

await test("Y=A 且 NOT×2 必用 → 唯一解：两个非门都参与", async () => {
  const result = await solvePuzzle(
    base({
      inputCount: 1,
      outputCount: 1,
      fixedNodes: io(1, 1),
      inventory: { NOT: 2 },
      mustUse: { NOT: 2 },
      target: [[0], [1]],
    }),
  );
  assert.equal(result.analysis.verdict, "unique", result.analysis.message);
  assert.equal(result.solutions[0].gates.length, 2);
});

await test("Y=A 且 NOT×1 可选 → 唯一解是直连，悬挂门不算解", async () => {
  const result = await solvePuzzle(
    base({
      inputCount: 1,
      outputCount: 1,
      fixedNodes: io(1, 1),
      inventory: { NOT: 1 },
      target: [[0], [1]],
    }),
  );
  assert.equal(result.analysis.verdict, "unique", result.analysis.message);
  assert.equal(result.solutions[0].gates.length, 0, "应只有直连这一种结构");
});

await test("Y=A∧B：AND(A,B) 与 NOT(NAND(A,B)) 是两种结构 → 多解", async () => {
  const result = await solvePuzzle(
    base({
      inventory: { AND: 1, NAND: 1, NOT: 1 },
      target: [[0], [0], [0], [1]],
    }),
  );
  assert.equal(result.analysis.verdict, "multiple", result.analysis.message);
});

await test("同种子同设置 → 完全可重现；布局也由种子决定", async () => {
  const input = base({
    inventory: { OR: 1, NAND: 1, AND: 1 },
    mustUse: { OR: 1, NAND: 1, AND: 1 },
  });
  const a = await solvePuzzle(input);
  const b = await solvePuzzle(input);
  assert.deepEqual(a.solutions, b.solutions);
  const s1 = buildSolutionSlice(a.solutions[0], input.fixedNodes, 42);
  const s2 = buildSolutionSlice(a.solutions[0], input.fixedNodes, 42);
  assert.deepEqual(s1, s2);
});

await test("固定 NOT 门留空输入脚 → 求解器接线并判定唯一", async () => {
  const nodes = [
    ...io(1, 1),
    { id: "fx-not", kind: "NOT", label: "NOT 1", value: 0, x: 400, y: 100, fixed: true } as GateNode,
  ];
  const result = await solvePuzzle(
    base({
      inputCount: 1,
      outputCount: 1,
      fixedNodes: nodes,
      target: [[1], [0]],
    }),
  );
  assert.equal(result.analysis.verdict, "unique", result.analysis.message);
  assert.equal(result.solutions[0].gates.length, 0);
  assert.equal(result.solutions[0].wires.length, 2);
});

await test("预算耗尽且未确认 → 只能报告尚未确认", async () => {
  const result = await solvePuzzle(
    base({ inventory: { OR: 1, NAND: 1, AND: 1 }, budget: 1 }),
  );
  assert.equal(result.analysis.verdict, "unconfirmed", result.analysis.message);
  assert.equal(result.analysis.exhausted, false);
});

await test("固定输出连线不重复计入解切片", async () => {
  const nodes = [
    ...io(1, 1),
    { id: "fx-not", kind: "NOT", label: "NOT 1", value: 0, x: 400, y: 100, fixed: true } as GateNode,
  ];
  const wires: Wire[] = [
    { id: "fw1", from: { nodeId: "fx-not", port: 0 }, to: { nodeId: "pz-out-0", port: 0 }, fixed: true },
  ];
  const result = await solvePuzzle(
    base({
      inputCount: 1,
      outputCount: 1,
      fixedNodes: nodes,
      fixedWires: wires,
      target: [[1], [0]],
    }),
  );
  assert.equal(result.analysis.verdict, "unique", result.analysis.message);
  assert.equal(result.solutions[0].wires.length, 1, "解只应包含 A→NOT 一条新连线");
  assert.equal(result.solutions[0].wires[0].to.nodeId, "fx-not");
});

await test("输入脚互换与同种门编号交换不产生额外解（XOR 计 1）", async () => {
  // 若把 AND(OR,NAND) 的输入脚互换、或门编号交换当成不同解，计数会 >1
  const result = await solvePuzzle(
    base({
      inventory: { OR: 1, NAND: 1, AND: 1 },
      mustUse: { OR: 1, NAND: 1, AND: 1 },
    }),
  );
  assert.equal(result.analysis.solutions, 1);
});

// ---------- 学生检测 ----------

function xorPuzzleState(solution: {
  nodes: GateNode[];
  wires: Wire[];
}): PuzzleState {
  return {
    def: {
      seed: 1,
      inputCount: 2,
      outputCount: 1,
      inventory: { OR: 1, NAND: 1, AND: 1 },
      mustUse: { OR: 1, NAND: 1, AND: 1 },
      target: XOR,
    },
    analysis: {
      verdict: "unique",
      solutions: 1,
      steps: 100,
      exhausted: true,
      message: "",
    },
    fixedSnapshot: { nodes: io(2, 1), wires: [] },
    solution,
    teacherCodeHash: null,
  };
}
const XOR_ANSWER = {
  nodes: [
    { id: "s1", kind: "OR", label: "OR 1", value: 0, x: 300, y: 100 },
    { id: "s2", kind: "NAND", label: "NAND 1", value: 0, x: 300, y: 300 },
    { id: "s3", kind: "AND", label: "AND 1", value: 0, x: 560, y: 200 },
  ] as GateNode[],
  wires: [
    { id: "w1", from: { nodeId: "pz-in-0", port: 0 }, to: { nodeId: "s1", port: 0 } },
    { id: "w2", from: { nodeId: "pz-in-1", port: 0 }, to: { nodeId: "s1", port: 1 } },
    { id: "w3", from: { nodeId: "pz-in-0", port: 0 }, to: { nodeId: "s2", port: 0 } },
    { id: "w4", from: { nodeId: "pz-in-1", port: 0 }, to: { nodeId: "s2", port: 1 } },
    { id: "w5", from: { nodeId: "s1", port: 0 }, to: { nodeId: "s3", port: 0 } },
    { id: "w6", from: { nodeId: "s2", port: 0 }, to: { nodeId: "s3", port: 1 } },
    { id: "w7", from: { nodeId: "s3", port: 0 }, to: { nodeId: "pz-out-0", port: 0 } },
  ] as Wire[],
};
function studentDoc(
  nodes: GateNode[],
  wires: Wire[],
  puzzle?: PuzzleState,
): CircuitDocument {
  return {
    version: puzzle ? 2 : 1,
    name: "学生",
    targetId: "xor",
    nodes: [...io(2, 1), ...nodes],
    wires,
    ...(puzzle ? { puzzle } : {}),
  };
}

await test("学生检测：正确作答通过（输入脚互换也算对）", () => {
  const puzzle = xorPuzzleState({ nodes: [], wires: [] });
  // 与教师解编号不同、输入脚互换的同构作答
  const nodes = XOR_ANSWER.nodes.map((n, i) => ({ ...n, id: `stu-${i}` }));
  const remap = new Map(XOR_ANSWER.nodes.map((n, i) => [n.id, `stu-${i}`]));
  const wires = XOR_ANSWER.wires.map((w, i) => {
    const swap = i === 0 || i === 1; // OR 的两个输入脚互换
    const from = remap.get(w.from.nodeId) ?? w.from.nodeId;
    const to = remap.get(w.to.nodeId) ?? w.to.nodeId;
    return {
      id: `sw${i}`,
      from: { nodeId: from, port: w.from.port },
      to: {
        nodeId: to,
        port:
          swap && to === "stu-0"
            ? ((1 - w.to.port) as 0 | 1)
            : w.to.port,
      },
    };
  });
  // 互换 OR 的两个来源
  const w0 = wires[0].from.nodeId;
  wires[0].from.nodeId = wires[1].from.nodeId;
  wires[1].from.nodeId = w0;
  const result = checkStudent(studentDoc(nodes, wires, puzzle), puzzle);
  assert.equal(result.fixedViolations.length, 0);
  assert.equal(result.inventoryViolations.length, 0);
  assert.equal(result.wiringViolations.length, 0);
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
});

await test("学生检测：缺必用门 + 行为不对 → 指出库存违规与行为失败", () => {
  const puzzle = xorPuzzleState({ nodes: [], wires: [] });
  const nodes: GateNode[] = [
    { id: "x1", kind: "OR", label: "OR 1", value: 0, x: 300, y: 100 },
  ];
  const wires: Wire[] = [
    { id: "w1", from: { nodeId: "pz-in-0", port: 0 }, to: { nodeId: "x1", port: 0 } },
    { id: "w2", from: { nodeId: "pz-in-1", port: 0 }, to: { nodeId: "x1", port: 1 } },
    { id: "w3", from: { nodeId: "x1", port: 0 }, to: { nodeId: "pz-out-0", port: 0 } },
  ];
  const result = checkStudent(studentDoc(nodes, wires, puzzle), puzzle);
  assert.equal(result.passed, false);
  assert.ok(
    result.inventoryViolations.some((v) => v.includes("NAND")),
    "应指出必用门 NAND 不足",
  );
  assert.ok(result.rows.some((r) => !r.matches), "行为应有失败行");
});

await test("学生检测：超出库存与悬挂门分别报告", () => {
  const puzzle = xorPuzzleState({ nodes: [], wires: [] });
  const nodes: GateNode[] = [
    ...XOR_ANSWER.nodes,
    { id: "extra", kind: "AND", label: "AND 2", value: 0, x: 700, y: 100 },
  ];
  const result = checkStudent(
    studentDoc(nodes, XOR_ANSWER.wires, puzzle),
    puzzle,
  );
  assert.equal(result.passed, false);
  assert.ok(
    result.inventoryViolations.some((v) => v.includes("AND")),
    "应指出 AND 超库存",
  );
  assert.ok(
    result.wiringViolations.some((v) => v.includes("悬挂")),
    "应指出悬挂门",
  );
});

await test("学生检测：拆除固定连线 → 固定位置违规", () => {
  const fixedWire: Wire = {
    id: "fw",
    from: { nodeId: "pz-in-0", port: 0 },
    to: { nodeId: "pz-out-0", port: 0 },
    fixed: true,
  };
  const puzzle = xorPuzzleState({ nodes: [], wires: [] });
  puzzle.fixedSnapshot.wires = [fixedWire];
  const result = checkStudent(studentDoc([], [], puzzle), puzzle);
  assert.equal(result.passed, false);
  assert.ok(result.fixedViolations.length > 0, "应报告固定连线被拆除");
});

await test("学生检测：移动固定门 → 固定位置违规", () => {
  const puzzle = xorPuzzleState({ nodes: [], wires: [] });
  const doc = studentDoc([], XOR_ANSWER.wires, puzzle);
  doc.nodes[0].x += 40; // 移动固定输入端
  const result = checkStudent(doc, puzzle);
  assert.ok(
    result.fixedViolations.some((v) => v.includes("移动")),
    "应报告固定端被移动",
  );
});

// ---------- 持久化 ----------

await test("v2 文档往返：教师解、固定边界、学生进度保持分离", () => {
  const puzzle = xorPuzzleState({
    nodes: XOR_ANSWER.nodes.map((n) => ({ ...n })),
    wires: XOR_ANSWER.wires.map((w) => ({ ...w })),
  });
  puzzle.teacherCodeHash = "abcd1234";
  const studentNodes: GateNode[] = [
    { id: "stu1", kind: "OR", label: "OR 1", value: 0, x: 300, y: 120 },
  ];
  const doc = studentDoc(studentNodes, [], puzzle);
  const text = encodeDocument(doc);
  const restored = decodeDocument(text);
  assert.equal(restored.version, 2);
  assert.ok(restored.puzzle, "谜题应保留");
  assert.deepEqual(restored.puzzle!.solution, puzzle.solution, "教师解应原样保留");
  assert.ok(
    restored.puzzle!.fixedSnapshot.nodes.every((n) => n.fixed),
    "固定边界应保留",
  );
  assert.ok(
    restored.nodes.some((n) => n.id === "stu1" && !n.fixed),
    "学生进度应保留",
  );
  assert.ok(
    !restored.nodes.some((n) => n.id === "s1"),
    "教师解不能混入学生线路",
  );
  assert.equal(restored.puzzle!.teacherCodeHash, "abcd1234");
});

await test("v1 旧文档仍可读取，且不带谜题", () => {
  const v1 = JSON.stringify({
    version: 1,
    name: "旧实验",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 0, x: 60, y: 120 },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, x: 820, y: 230 },
    ],
    wires: [
      { id: "w1", from: { nodeId: "a", port: 0 }, to: { nodeId: "y", port: 0 } },
    ],
  });
  const doc = decodeDocument(v1);
  assert.equal(doc.version, 1);
  assert.equal(doc.puzzle, undefined);
});

console.log(`\n${passed} 项测试通过`);
