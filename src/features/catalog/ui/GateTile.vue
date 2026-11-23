<script setup lang="ts">
import type { GateSpec } from "@/shared/types";
defineProps<{
  spec: GateSpec;
  active: boolean;
  disabled?: boolean;
  /** 谜题库存剩余；null 表示不限 */
  stock?: number | null;
}>();
defineEmits<{ choose: [] }>();
</script>
<template>
  <button
    class="gate-tile"
    :class="{ active, 'tile-disabled': disabled }"
    :title="spec.description"
    :aria-pressed="active"
    :disabled="disabled"
    @click="$emit('choose')"
  >
    <span class="gate-symbol">{{ spec.symbol }}</span
    ><span
      ><strong>{{ spec.name }}</strong
      ><small>{{ spec.kind }}</small></span
    ><span v-if="stock !== null && stock !== undefined" class="tile-stock"
      >剩 {{ stock }}</span
    ><span v-else class="tile-plus">＋</span>
  </button>
</template>
