<script setup lang="ts">
import { computed } from "vue";
import { INPUT_LABELS, OUTPUT_LABELS } from "../lib/puzzleDoc";

const props = defineProps<{
  inputCount: number;
  outputCount: number;
  target: (0 | 1)[][];
  readonly?: boolean;
}>();
const emit = defineEmits<{ toggle: [cell: { row: number; col: number }] }>();
const inputLabels = computed(() =>
  Array.from({ length: props.inputCount }, (_, i) => INPUT_LABELS[i] ?? `I${i + 1}`),
);
const outputLabels = computed(() =>
  Array.from({ length: props.outputCount }, (_, j) => OUTPUT_LABELS[j] ?? `Y${j + 1}`),
);
const rows = computed(() =>
  props.target.map((outputs, row) => ({
    inputs: Array.from(
      { length: props.inputCount },
      (_, i) => (row >> (props.inputCount - 1 - i)) & 1,
    ),
    outputs,
    row,
  })),
);
function toggle(row: number, col: number) {
  if (!props.readonly) emit("toggle", { row, col });
}
</script>
<template>
  <table class="truth-table target-editor">
    <thead>
      <tr>
        <th v-for="label in inputLabels" :key="`i${label}`">{{ label }}</th>
        <th
          v-for="label in outputLabels"
          :key="`o${label}`"
          class="target-col"
        >
          目标 {{ label }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.row">
        <td v-for="(bit, i) in row.inputs" :key="i" class="input-bit">
          {{ bit }}
        </td>
        <td v-for="(bit, j) in row.outputs" :key="`t${j}`" class="target-col">
          <button
            class="bit-toggle"
            :class="{ on: bit === 1, readonly: readonly }"
            :aria-label="`第 ${row.row + 1} 行输出 ${j + 1}，当前 ${bit}`"
            @click="toggle(row.row, j)"
          >
            {{ bit }}
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
