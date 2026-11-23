/**
 * 谜题功能端到端流程测试（composable 层）。
 * 运行：node --experimental-strip-types --import ./scripts/register.mjs scripts/puzzle-flow.test.mts
 */
import assert from "node:assert/strict";
import { ref } from "vue";
import { usePuzzle } from "../src/features/puzzle/model/usePuzzle.ts";
import {
  decodeDocument,
  encodeDocument,
} from "../src/features/workspace/lib/codec.ts";
import type { CircuitDocument } from "../src/shared/types.ts";

const notices: string[] = [];
const notify = (n: { tone: string; message: string }) =>
  notices.push(`${n.tone}: ${n.message}`);

function emptyDoc(): CircuitDocument {
  return { version: 1, name: "流程", targetId: "xor", nodes: [], wires: [] };
}

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await test("完整流程：设计→生成→作答→检测→查看答案→存档分离", async () => {
  const document = ref(emptyDoc());
  const pz = usePuzzle(document, notify);

  // 教师设置
  pz.draft.inputCount = 2;
  pz.draft.outputCount = 1;
  pz.resizeTarget();
  pz.draft.inventory = { OR: 1, NAND: 1, AND: 1 };
  pz.draft.mustUse = { OR: 1, NAND: 1, AND: 1 };
  pz.draft.target = [[0], [1], [1], [0]];
  pz.draft.seed = 99;
  pz.draft.teacherCode = "teach";

  pz.beginDesign();
  assert.equal(document.value.nodes.length, 2 + 1, "应创建 2 输入 1 输出");
  assert.ok(document.value.nodes.every((n) => n.fixed), "端口应为固定");

  await pz.generate();
  assert.ok(pz.active.value, "生成后谜题应激活");
  assert.equal(pz.puzzle.value!.analysis.verdict, "unique");
  assert.equal(document.value.version, 1, "版本号由编码器决定");
  assert.ok(pz.puzzle.value!.solution, "应附带教师解");
  assert.ok(pz.puzzle.value!.teacherCodeHash, "应保存口令散列");

  // 学生从留空状态接线（库存内）
  assert.equal(pz.canPlace("OR"), true);
  assert.equal(pz.canPlace("INPUT"), false, "谜题模式不能加输入端");
  const [a, b, y] = document.value.nodes;
  const gates = [
    { id: "g-or", kind: "OR", label: "OR 1", value: 0, x: 300, y: 100 },
    { id: "g-nand", kind: "NAND", label: "NAND 1", value: 0, x: 300, y: 300 },
    { id: "g-and", kind: "AND", label: "AND 1", value: 0, x: 560, y: 200 },
  ] as const;
  document.value.nodes.push(...gates.map((g) => ({ ...g })));
  const wire = (id: string, from: string, to: string, port: number) => ({
    id,
    from: { nodeId: from, port: 0 },
    to: { nodeId: to, port },
  });
  document.value.wires.push(
    wire("w1", a.id, "g-or", 0),
    wire("w2", b.id, "g-or", 1),
    wire("w3", a.id, "g-nand", 0),
    wire("w4", b.id, "g-nand", 1),
    wire("w5", "g-or", "g-and", 0),
    wire("w6", "g-nand", "g-and", 1),
    wire("w7", "g-and", y.id, 0),
  );
  pz.runCheck();
  assert.equal(pz.checkResult.value!.passed, true, "正确作答应通过");

  // 教师口令错误 → 拒绝展开
  assert.equal(pz.reveal("wrong"), false);
  assert.equal(pz.revealed.value, false);
  // 正确口令 → 展开，且学生线路不变
  const wiresBefore = document.value.wires.length;
  assert.equal(pz.reveal("teach"), true);
  assert.equal(pz.revealed.value, true);
  assert.equal(document.value.wires.length, wiresBefore, "查看答案不能改动学生线路");
  assert.ok(
    !document.value.nodes.some((n) => pz.puzzle.value!.solution!.nodes.some((s) => s.id === n.id)),
    "教师解不能混入学生文档",
  );

  // 存档往返：三部分保持分离
  const text = encodeDocument(document.value);
  const restored = decodeDocument(text);
  assert.ok(restored.puzzle, "教师解与谜题定义应保留");
  assert.equal(restored.puzzle!.solution!.nodes.length, 3);
  assert.equal(
    restored.nodes.filter((n) => n.fixed).length,
    3,
    "固定边界应保留",
  );
  assert.equal(
    restored.nodes.filter((n) => !n.fixed).length,
    3,
    "学生进度应保留",
  );
  assert.equal(restored.puzzle!.teacherCodeHash, pz.puzzle.value!.teacherCodeHash);

  // 清空作答：固定部分与教师解保留
  pz.resetStudent();
  assert.equal(document.value.nodes.filter((n) => !n.fixed).length, 0);
  assert.equal(document.value.nodes.filter((n) => n.fixed).length, 3);
  assert.ok(pz.puzzle.value!.solution);

  pz.endPuzzle();
  assert.equal(pz.active.value, false);
  assert.ok(document.value.nodes.every((n) => !n.fixed), "结束后应解除固定");
});

await test("无解与多解判定在流程中可见", async () => {
  const document = ref(emptyDoc());
  const pz = usePuzzle(document, notify);
  pz.draft.inputCount = 2;
  pz.draft.outputCount = 1;
  pz.resizeTarget();
  pz.draft.inventory = { AND: 1 };
  pz.draft.mustUse = {};
  pz.draft.target = [[0], [1], [1], [0]]; // XOR，AND 做不出
  pz.beginDesign();
  await pz.generate();
  assert.equal(pz.active.value, false, "无解不应激活谜题");
  assert.equal(pz.lastAnalysis.value!.verdict, "none");
});

console.log(`\n${passed} 项流程测试通过`);
