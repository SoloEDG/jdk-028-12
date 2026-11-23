<script setup lang="ts">
import type { GateKind, Inventory } from "@/shared/types";
import { gateSpecs } from "../lib/specs";
import GateTile from "./GateTile.vue";
const props = defineProps<{
  tool: GateKind | null;
  /** 谜题模式的剩余库存；为 null 表示自由实验，不受限制 */
  remaining: Inventory | null;
}>();
const emit = defineEmits<{ choose: [kind: GateKind | null] }>();
function available(kind: GateKind): boolean {
  if (!props.remaining) return true;
  if (kind === "INPUT" || kind === "OUTPUT") return false;
  return (props.remaining[kind] ?? 0) > 0;
}
function choose(kind: GateKind) {
  if (!available(kind)) return;
  emit("choose", props.tool === kind ? null : kind);
}
</script>
<template>
  <aside class="catalog panel">
    <div class="panel-heading">
      <span>元件库</span><small>COMPONENTS</small>
    </div>
    <p class="panel-help">
      {{ remaining ? "谜题模式：只能使用库存中的门。" : "选择元件，再点击工作台放置。" }}
    </p>
    <div class="gate-list">
      <GateTile
        v-for="spec in gateSpecs"
        :key="spec.kind"
        :spec="spec"
        :active="tool === spec.kind"
        :disabled="!available(spec.kind)"
        :stock="
          remaining && spec.kind !== 'INPUT' && spec.kind !== 'OUTPUT'
            ? (remaining[spec.kind] ?? 0)
            : null
        "
        @choose="choose(spec.kind)"
      />
    </div>
    <div class="legend">
      <span><i class="dot high" />高电平 1</span
      ><span><i class="dot low" />低电平 0</span
      ><span><i class="dot unknown" />未确定 X</span>
    </div>
    <p class="small-note">
      先点输出端口，再点输入端口。<br />一个输出可以连接多个输入。
    </p>
  </aside>
</template>
