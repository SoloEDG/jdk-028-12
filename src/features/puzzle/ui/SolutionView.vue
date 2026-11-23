<script setup lang="ts">
import { computed } from "vue";
import type { CircuitSlice, GateNode, Wire } from "@/shared/types";
import { getSpec } from "@/features/catalog";
import { portPoint, wirePath } from "@/features/circuit/lib/geometry";

const props = defineProps<{
  fixed: CircuitSlice;
  solution: CircuitSlice;
}>();
/** 教师解完整视图：固定部分 + 解答门 + 全部连线，纯只读 */
const nodes = computed<GateNode[]>(() => [
  ...props.fixed.nodes,
  ...props.solution.nodes,
]);
const wires = computed<Wire[]>(() => [
  ...props.fixed.wires,
  ...props.solution.wires,
]);
const nodeById = computed(() => new Map(nodes.value.map((n) => [n.id, n])));
function path(wire: Wire): string {
  const from = nodeById.value.get(wire.from.nodeId);
  const to = nodeById.value.get(wire.to.nodeId);
  if (!from || !to) return "";
  return wirePath(
    portPoint(from, "output", wire.from.port),
    portPoint(to, "input", wire.to.port),
  );
}
const solutionIds = computed(() => new Set(props.solution.nodes.map((n) => n.id)));
</script>
<template>
  <svg
    class="solution-view"
    viewBox="0 0 1000 520"
    role="img"
    aria-label="教师参考解（只读）"
  >
    <path
      v-for="wire in wires"
      :key="wire.id"
      :d="path(wire)"
      class="solution-wire"
      :class="{ 'solution-wire-fixed': wire.fixed }"
    />
    <g v-for="node in nodes" :key="node.id" class="solution-node">
      <rect
        :x="node.x"
        :y="node.y"
        width="112"
        height="86"
        rx="10"
        :class="{
          'solution-node-fixed': !solutionIds.has(node.id) && node.kind !== 'INPUT' && node.kind !== 'OUTPUT',
          'solution-node-new': solutionIds.has(node.id),
        }"
      />
      <text :x="node.x + 12" :y="node.y + 21" class="solution-label">
        {{ node.label }}
      </text>
      <text :x="node.x + 56" :y="node.y + 57" class="solution-symbol">
        {{ getSpec(node.kind).symbol }}
      </text>
    </g>
  </svg>
</template>
