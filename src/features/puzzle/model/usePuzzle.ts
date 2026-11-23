import { computed, reactive, ref, watch, type Ref } from "vue";
import type {
  CircuitDocument,
  GateKind,
  Inventory,
  PuzzleAnalysis,
} from "@/shared/types";
import type { Notice } from "@/shared/commands";
import { fnvHash, createRng, randomInt } from "../lib/bits";
import { solvePuzzle, BUDGET_OPTIONS } from "../lib/solver";
import { buildSolutionSlice } from "../lib/layout";
import { checkStudent, type CheckResult } from "../lib/check";
import {
  blankTarget,
  createIoNodes,
  fixedSnapshotOf,
  randomTarget,
  remainingInventory,
  usedInventory,
} from "../lib/puzzleDoc";

export function usePuzzle(
  document: Ref<CircuitDocument>,
  notify: (notice: Notice) => void,
) {
  // ---- 教师设置草稿（不持久化） ----
  const draft = reactive({
    inputCount: 2,
    outputCount: 1,
    inventory: { AND: 1, OR: 1, NAND: 1 } as Inventory,
    mustUse: {} as Inventory,
    seed: 20261123,
    budget: BUDGET_OPTIONS[1].value as number,
    teacherCode: "",
    target: blankTarget(2, 1),
  });
  const designing = ref(false);
  const busy = ref(false);
  const progress = ref(0);
  const lastAnalysis = ref<PuzzleAnalysis | null>(null);
  // ---- 教师解展开状态（不持久化，重开即收起） ----
  const revealed = ref(false);
  const revealError = ref("");
  // ---- 学生检测结果 ----
  const checkResult = ref<CheckResult | null>(null);

  const puzzle = computed(() => document.value.puzzle ?? null);
  const active = computed(() => puzzle.value !== null);
  const used = computed(() => usedInventory(document.value));
  const remaining = computed(() =>
    puzzle.value
      ? remainingInventory(puzzle.value.def.inventory, used.value)
      : null,
  );

  // 学生或教师一改动线路，旧的检测结果即失效
  watch(
    document,
    () => {
      checkResult.value = null;
    },
    { deep: true },
  );

  /** 开始设计：清空工作台并创建固定输入输出端 */
  function beginDesign() {
    document.value.puzzle = undefined;
    document.value.nodes = createIoNodes(draft.inputCount, draft.outputCount);
    document.value.wires = [];
    designing.value = true;
    revealed.value = false;
    lastAnalysis.value = null;
    notify({
      tone: "info",
      message: "已创建固定输入输出端。放置固定门并连线后，点击“标记为固定”。",
    });
  }
  /** 把当前工作台上所有元件与连线标记为固定（留空边界） */
  function markFixed() {
    for (const node of document.value.nodes) node.fixed = true;
    for (const wire of document.value.wires) wire.fixed = true;
    const gates = document.value.nodes.filter(
      (n) => n.kind !== "INPUT" && n.kind !== "OUTPUT",
    ).length;
    notify({
      tone: "success",
      message: `已固定 ${document.value.nodes.length} 个元件（含 ${gates} 个门）与 ${document.value.wires.length} 条连线`,
    });
  }
  /** 解除除输入输出端外的固定标记 */
  function unfixAll() {
    for (const node of document.value.nodes)
      if (node.kind !== "INPUT" && node.kind !== "OUTPUT") node.fixed = false;
    document.value.wires.forEach((w) => (w.fixed = false));
    notify({ tone: "info", message: "已解除门与连线的固定标记（端口保持固定）" });
  }
  /** 输入输出数量变化：重建空白目标，尽量保留已编辑列 */
  function resizeTarget() {
    const next = blankTarget(draft.inputCount, draft.outputCount);
    const rows = Math.min(next.length, draft.target.length);
    for (let r = 0; r < rows; r++)
      for (let j = 0; j < Math.min(draft.outputCount, draft.target[r].length); j++)
        next[r][j] = draft.target[r][j];
    draft.target = next;
  }
  /** 用当前种子生成随机目标行为 */
  function randomizeTarget() {
    draft.target = randomTarget(draft.seed, draft.inputCount, draft.outputCount);
    notify({ tone: "info", message: `已用种子 ${draft.seed} 生成随机目标行为` });
  }
  function randomizeSeed() {
    draft.seed = Math.floor(Math.random() * 900_000_000) + 1;
  }

  /** 分析并生成谜题 */
  async function generate() {
    if (busy.value) return;
    const strayNodes = document.value.nodes.filter((n) => !n.fixed);
    const strayWires = document.value.wires.filter((w) => !w.fixed);
    if (strayNodes.length || strayWires.length) {
      notify({
        tone: "error",
        message: `工作台上还有 ${strayNodes.length} 个未固定元件、${strayWires.length} 条未固定连线，请先“标记当前为固定”或删除它们`,
      });
      return;
    }
    const fixedNodes = document.value.nodes.filter((n) => n.fixed);
    const fixedWires = document.value.wires.filter((w) => w.fixed);
    const ioOk =
      fixedNodes.filter((n) => n.kind === "INPUT").length ===
        draft.inputCount &&
      fixedNodes.filter((n) => n.kind === "OUTPUT").length ===
        draft.outputCount;
    if (!ioOk) {
      notify({
        tone: "error",
        message: "固定端口数量与设置不符，请先点击“创建输入输出端”",
      });
      return;
    }
    const gateTotal =
      fixedNodes.filter((n) => n.kind !== "INPUT" && n.kind !== "OUTPUT")
        .length +
      Object.values(draft.inventory).reduce((a, b) => a + b, 0);
    if (gateTotal > 8) {
      notify({
        tone: "error",
        message: `固定门加库存门共 ${gateTotal} 个，超过 8 个上限，请缩小规模`,
      });
      return;
    }
    busy.value = true;
    progress.value = 0;
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const result = await solvePuzzle({
        inputCount: draft.inputCount,
        outputCount: draft.outputCount,
        inventory: draft.inventory,
        mustUse: draft.mustUse,
        target: draft.target,
        fixedNodes: fixedNodes.map((n) => ({ ...n })),
        fixedWires: fixedWires.map((w) => ({ ...w })),
        budget: draft.budget,
        onProgress: (steps) => (progress.value = steps),
      });
      lastAnalysis.value = result.analysis;
      if (!result.solutions.length) {
        notify({ tone: "error", message: result.analysis.message });
        return;
      }
      // 种子决定参考解选取：同种子同设置 → 同一份题目
      const rng = createRng(draft.seed);
      const picked = result.solutions[randomInt(rng, result.solutions.length)];
      document.value.puzzle = {
        def: {
          seed: draft.seed,
          inputCount: draft.inputCount,
          outputCount: draft.outputCount,
          inventory: { ...draft.inventory },
          mustUse: { ...draft.mustUse },
          target: draft.target.map((row) => [...row]),
        },
        analysis: result.analysis,
        fixedSnapshot: fixedSnapshotOf(document.value),
        solution: buildSolutionSlice(picked, fixedNodes, draft.seed),
        teacherCodeHash: draft.teacherCode
          ? fnvHash(draft.teacherCode)
          : null,
      };
      designing.value = false;
      revealed.value = false;
      checkResult.value = null;
      notify({
        tone: result.analysis.verdict === "unique" ? "success" : "info",
        message: `谜题已生成。${result.analysis.message}`,
      });
    } catch (error) {
      notify({
        tone: "error",
        message: `分析失败：${error instanceof Error ? error.message : "未知错误"}`,
      });
    } finally {
      busy.value = false;
    }
  }

  /** 结束谜题模式：解除全部固定，回到自由实验 */
  function endPuzzle() {
    document.value.puzzle = undefined;
    for (const node of document.value.nodes) node.fixed = false;
    for (const wire of document.value.wires) wire.fixed = false;
    designing.value = false;
    revealed.value = false;
    checkResult.value = null;
    notify({ tone: "info", message: "谜题模式已结束，所有元件已解除固定" });
  }
  /** 清空学生作答，保留固定部分与教师解 */
  function resetStudent() {
    document.value.nodes = document.value.nodes.filter((n) => n.fixed);
    document.value.wires = document.value.wires.filter((w) => w.fixed);
    checkResult.value = null;
    notify({ tone: "info", message: "已清空学生作答，固定部分保持不变" });
  }
  /** 学生检测：行为 + 库存 + 固定边界，不比对教师解编号 */
  function runCheck() {
    if (!puzzle.value) return;
    checkResult.value = checkStudent(document.value, puzzle.value);
    notify({
      tone: checkResult.value.passed ? "success" : "info",
      message: checkResult.value.passed
        ? "✓ 作答正确，行为与约束全部通过"
        : "检测完成，请查看右侧报告",
    });
  }
  /** 教师展开答案：只读展示，绝不改动学生线路 */
  function reveal(code: string): boolean {
    revealError.value = "";
    const hash = puzzle.value?.teacherCodeHash;
    if (hash && fnvHash(code) !== hash) {
      revealError.value = "教师口令不正确";
      return false;
    }
    revealed.value = true;
    return true;
  }
  function hideSolution() {
    revealed.value = false;
  }
  /** 文档被替换（导入/新建/载入示例）时重置瞬态 */
  function reset() {
    designing.value = false;
    busy.value = false;
    progress.value = 0;
    lastAnalysis.value = null;
    revealed.value = false;
    revealError.value = "";
    checkResult.value = null;
  }
  /** 谜题模式下某种元件是否还能放置 */
  function canPlace(kind: GateKind): boolean {
    if (!active.value && !designing.value) return true;
    if (kind === "INPUT" || kind === "OUTPUT") return false;
    if (!active.value) return true; // 设计模式：搭建固定部分不受库存限制
    return (remaining.value?.[kind] ?? 0) > 0;
  }

  return {
    draft,
    designing,
    busy,
    progress,
    lastAnalysis,
    revealed,
    revealError,
    checkResult,
    puzzle,
    active,
    remaining,
    beginDesign,
    markFixed,
    unfixAll,
    resizeTarget,
    randomizeTarget,
    randomizeSeed,
    generate,
    endPuzzle,
    resetStudent,
    runCheck,
    reveal,
    hideSolution,
    reset,
    canPlace,
  };
}
