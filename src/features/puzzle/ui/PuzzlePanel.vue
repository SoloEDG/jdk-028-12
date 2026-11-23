<script setup lang="ts">
import { computed, ref } from "vue";
import type { PuzzleGateKind, PuzzleVerdict } from "@/shared/types";
import { gateSpecs } from "@/features/catalog";
import { BUDGET_OPTIONS, SOLVER_LIMITS } from "../lib/solver";
import type { usePuzzle } from "../model/usePuzzle";
import TargetEditor from "./TargetEditor.vue";
import SolutionView from "./SolutionView.vue";

const props = defineProps<{ puzzle: ReturnType<typeof usePuzzle> }>();
const pz = props.puzzle;

const gateKinds = gateSpecs
  .map((spec) => spec.kind)
  .filter(
    (kind): kind is PuzzleGateKind =>
      kind !== "INPUT" && kind !== "OUTPUT",
  );

const codeInput = ref("");
const askingCode = ref(false);

const verdictMeta: Record<PuzzleVerdict, { label: string; tone: string }> = {
  unique: { label: "唯一解", tone: "ok" },
  multiple: { label: "多解", tone: "warn" },
  none: { label: "无解", tone: "bad" },
  "invalid-fixed": { label: "固定部分无解", tone: "bad" },
  unconfirmed: { label: "尚未确认", tone: "muted" },
};
const analysis = computed(
  () => pz.puzzle.value?.analysis ?? pz.lastAnalysis.value,
);
const mustUseList = computed(() => {
  if (!pz.puzzle.value) return [];
  return gateKinds
    .filter((kind) => (pz.puzzle.value!.def.mustUse[kind] ?? 0) > 0)
    .map(
      (kind) => `${kind} × ${pz.puzzle.value!.def.mustUse[kind]}`,
    );
});
const inventoryList = computed(() => {
  if (!pz.puzzle.value || !pz.remaining.value) return [];
  return gateKinds
    .filter((kind) => (pz.puzzle.value!.def.inventory[kind] ?? 0) > 0)
    .map((kind) => ({
      kind,
      left: pz.remaining.value![kind] ?? 0,
      total: pz.puzzle.value!.def.inventory[kind] ?? 0,
    }));
});

function setInventory(kind: PuzzleGateKind, value: number) {
  const count = Math.max(0, Math.min(SOLVER_LIMITS.maxPerKind, value | 0));
  pz.draft.inventory[kind] = count;
  if ((pz.draft.mustUse[kind] ?? 0) > count) pz.draft.mustUse[kind] = count;
  if (!count) {
    delete pz.draft.inventory[kind];
    delete pz.draft.mustUse[kind];
  }
}
function setMustUse(kind: PuzzleGateKind, value: number) {
  const count = Math.max(
    0,
    Math.min(pz.draft.inventory[kind] ?? 0, value | 0),
  );
  if (count) pz.draft.mustUse[kind] = count;
  else delete pz.draft.mustUse[kind];
}
function toggleTarget(cell: { row: number; col: number }) {
  const row = pz.draft.target[cell.row];
  if (row) row[cell.col] = row[cell.col] === 1 ? 0 : 1;
}
function confirmBegin() {
  if (
    window.confirm(
      "开始设计会清空当前工作台并创建固定输入输出端，建议先导出。继续吗？",
    )
  )
    pz.beginDesign();
}
function confirmEnd() {
  if (window.confirm("结束谜题模式？所有固定将被解除，教师解将被丢弃。"))
    pz.endPuzzle();
}
function confirmResetStudent() {
  if (window.confirm("清空学生的全部作答？固定部分与教师解保持不变。"))
    pz.resetStudent();
}
function tryReveal() {
  if (!pz.puzzle.value) return;
  if (pz.puzzle.value.teacherCodeHash) {
    askingCode.value = true;
    return;
  }
  if (
    window.confirm(
      "确认以教师身份展开参考解？学生线路不会被改动。",
    )
  )
    pz.reveal("");
}
function submitCode() {
  if (pz.reveal(codeInput.value)) {
    askingCode.value = false;
    codeInput.value = "";
  }
}
</script>

<template>
  <aside class="challenge panel puzzle-panel">
    <div class="panel-heading">
      <span>电路谜题</span><small>PUZZLE</small>
    </div>

    <!-- ============ 教师设置 ============ -->
    <template v-if="!pz.active.value">
      <p class="panel-help">
        教师在此出题：设置端口与库存、固定部分线路、指定目标行为，
        系统会搜索全部结构解并判定唯一性。
      </p>

      <div class="pz-section">
        <div class="pz-subheading">① 端口与种子</div>
        <div class="pz-grid">
          <label
            >输入数量
            <select
              :value="pz.draft.inputCount"
              @change="
                pz.draft.inputCount = Number(
                  ($event.target as HTMLSelectElement).value,
                );
                pz.resizeTarget();
              "
            >
              <option v-for="n in 4" :key="n" :value="n">{{ n }}</option>
            </select></label
          >
          <label
            >输出数量
            <select
              :value="pz.draft.outputCount"
              @change="
                pz.draft.outputCount = Number(
                  ($event.target as HTMLSelectElement).value,
                );
                pz.resizeTarget();
              "
            >
              <option v-for="n in 2" :key="n" :value="n">{{ n }}</option>
            </select></label
          >
          <label
            >随机种子
            <input
              type="number"
              :value="pz.draft.seed"
              min="1"
              @change="
                pz.draft.seed =
                  Math.abs(Math.trunc(Number(($event.target as HTMLInputElement).value))) || 1
              "
          /></label>
          <button class="pz-inline" @click="pz.randomizeSeed()">
            换个种子 🎲
          </button>
        </div>
        <button class="pz-wide" @click="confirmBegin">
          创建输入输出端（清空工作台）
        </button>
        <p class="pz-note" v-if="pz.designing.value">
          设计模式：请在工作台放置固定门并连线，完成后标记为固定。
        </p>
      </div>

      <div class="pz-section">
        <div class="pz-subheading">② 门库存与必用</div>
        <div class="pz-inventory">
          <div class="pz-inventory-head">
            <span>门</span><span>库存</span><span>必用</span>
          </div>
          <div v-for="kind in gateKinds" :key="kind" class="pz-inventory-row">
            <span>{{ kind }}</span>
            <input
              type="number"
              min="0"
              :max="SOLVER_LIMITS.maxPerKind"
              :value="pz.draft.inventory[kind] ?? 0"
              @change="
                setInventory(
                  kind,
                  Number(($event.target as HTMLInputElement).value),
                )
              "
            />
            <input
              type="number"
              min="0"
              :max="pz.draft.inventory[kind] ?? 0"
              :value="pz.draft.mustUse[kind] ?? 0"
              :disabled="!pz.draft.inventory[kind]"
              @change="
                setMustUse(
                  kind,
                  Number(($event.target as HTMLInputElement).value),
                )
              "
            />
          </div>
        </div>
        <p class="pz-note">必用门必须全部参与目标输出；悬挂门不算有效解。</p>
      </div>

      <div class="pz-section">
        <div class="pz-subheading">③ 目标行为</div>
        <button class="pz-wide" @click="pz.randomizeTarget()">
          用种子随机生成目标
        </button>
        <TargetEditor
          :input-count="pz.draft.inputCount"
          :output-count="pz.draft.outputCount"
          :target="pz.draft.target"
          @toggle="toggleTarget"
        />
      </div>

      <div class="pz-section">
        <div class="pz-subheading">④ 固定部分与搜索</div>
        <div class="pz-grid">
          <button class="pz-inline" @click="pz.markFixed()">
            标记当前为固定
          </button>
          <button class="pz-inline" @click="pz.unfixAll()">解除固定标记</button>
        </div>
        <label class="pz-budget"
          >搜索预算
          <select
            :value="pz.draft.budget"
            @change="
              pz.draft.budget = Number(($event.target as HTMLSelectElement).value)
            "
          >
            <option
              v-for="option in BUDGET_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select></label
        >
        <label class="pz-budget"
          >教师口令（可选）
          <input
            type="password"
            :value="pz.draft.teacherCode"
            maxlength="24"
            placeholder="留空则确认后即可查看"
            @change="
              pz.draft.teacherCode = ($event.target as HTMLInputElement).value
            "
        /></label>
        <button
          class="primary check-button"
          :disabled="pz.busy.value"
          @click="pz.generate()"
        >
          {{ pz.busy.value ? `分析中… ${pz.progress.value} 步` : "分析并生成谜题" }}
          <span>↗</span>
        </button>
        <p
          v-if="analysis"
          class="pz-verdict"
          :class="verdictMeta[analysis.verdict].tone"
          role="status"
        >
          <b>{{ verdictMeta[analysis.verdict].label }}</b>
          {{ analysis.message }}
          <small>搜索 {{ analysis.steps }} 步</small>
        </p>
      </div>
    </template>

    <!-- ============ 谜题进行中 ============ -->
    <template v-else>
      <div class="pz-status">
        <span class="pz-chip" :class="verdictMeta[analysis!.verdict].tone">
          {{ verdictMeta[analysis!.verdict].label }}
        </span>
        <small>种子 {{ pz.puzzle.value!.def.seed }}</small>
      </div>
      <p class="pz-note">{{ analysis!.message }}</p>

      <div class="pz-section">
        <div class="pz-subheading">学生作答</div>
        <TargetEditor
          :input-count="pz.puzzle.value!.def.inputCount"
          :output-count="pz.puzzle.value!.def.outputCount"
          :target="pz.puzzle.value!.def.target"
          readonly
        />
        <div class="pz-stock">
          <span v-for="item in inventoryList" :key="item.kind" class="pz-stock-item">
            {{ item.kind }} 剩 {{ item.left }}/{{ item.total }}
          </span>
        </div>
        <p v-if="mustUseList.length" class="pz-note">
          必用门：{{ mustUseList.join("、") }}
        </p>
        <div class="pz-grid">
          <button class="primary pz-inline" @click="pz.runCheck()">
            检测我的电路
          </button>
          <button class="pz-inline" @click="confirmResetStudent">
            清空我的作答
          </button>
        </div>

        <div v-if="pz.checkResult.value" class="pz-report" role="status">
          <p
            class="check-result"
            :class="pz.checkResult.value.passed ? 'passed' : 'failed'"
          >
            {{
              pz.checkResult.value.passed
                ? "✓ 作答正确：行为匹配，库存与固定约束全部满足"
                : "尚未通过，请查看下列问题"
            }}
          </p>
          <template v-if="!pz.checkResult.value.passed">
            <ul
              v-if="pz.checkResult.value.fixedViolations.length"
              class="pz-violations"
            >
              <li
                v-for="item in pz.checkResult.value.fixedViolations"
                :key="item"
              >
                固定位置违规：{{ item }}
              </li>
            </ul>
            <ul
              v-if="pz.checkResult.value.inventoryViolations.length"
              class="pz-violations"
            >
              <li
                v-for="item in pz.checkResult.value.inventoryViolations"
                :key="item"
              >
                库存违规：{{ item }}
              </li>
            </ul>
            <ul
              v-if="pz.checkResult.value.wiringViolations.length"
              class="pz-violations"
            >
              <li
                v-for="item in pz.checkResult.value.wiringViolations"
                :key="item"
              >
                接线问题：{{ item }}
              </li>
            </ul>
            <p v-if="pz.checkResult.value.behaviorError" class="pz-violations">
              {{ pz.checkResult.value.behaviorError }}
            </p>
            <p v-else-if="pz.checkResult.value.rows.length" class="pz-note">
              行为核对：{{ pz.checkResult.value.rows.filter((r) => r.matches).length }}
              / {{ pz.checkResult.value.rows.length }} 行匹配
            </p>
          </template>
        </div>
      </div>

      <div class="pz-section">
        <div class="pz-subheading">教师解答</div>
        <p v-if="!pz.puzzle.value!.solution" class="pz-note">
          该谜题未附带参考解。
        </p>
        <template v-else-if="!pz.revealed.value">
          <button class="pz-wide" @click="tryReveal">展开参考解（仅教师）</button>
          <div v-if="askingCode" class="pz-code">
            <input
              v-model="codeInput"
              type="password"
              placeholder="教师口令"
              aria-label="教师口令"
              @keydown.enter="submitCode"
            />
            <button @click="submitCode">确认</button>
          </div>
          <p v-if="pz.revealError.value" class="inline-error">
            {{ pz.revealError.value }}
          </p>
          <p class="pz-note">展开答案不会改动学生的任何线路。</p>
        </template>
        <template v-else>
          <SolutionView
            :fixed="pz.puzzle.value!.fixedSnapshot"
            :solution="pz.puzzle.value!.solution!"
          />
          <p class="pz-note">
            橙色为待接部分，灰色为固定部分。学生线路保持原样，未被改动。
          </p>
          <button class="pz-wide" @click="pz.hideSolution()">收起参考解</button>
        </template>
      </div>

      <button class="text-button" @click="confirmEnd">结束谜题模式</button>
    </template>
  </aside>
</template>
