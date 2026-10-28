<template>
  <div class="rec" @click="$emit('click', item)">
    <CatIcon :icon="item.categoryIcon" :color="item.categoryColor" :size="40" />
    <div class="rec__main">
      <span class="rec__name">{{ item.categoryName }}</span>
      <span v-if="meta" class="rec__note rec__meta">{{ meta }}</span>
    </div>
    <div class="rec__right">
      <span
        class="rec__amount num"
        :class="item.type === 'income' ? 'text-income' : 'text-expense'"
      >
        {{ item.type === 'income' ? '+' : '-' }}{{ money(item.amount) }}
      </span>
      <span v-if="showDate" class="rec__date">{{ friendlyDate(item.date) }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import CatIcon from './CatIcon.vue'
import { friendlyDate, money } from '@/utils/format'

const props = defineProps({
  item: { type: Object, required: true },
  /** 首页最近记录：右侧显示日期，没有备注时用日期兜底 */
  showDate: { type: Boolean, default: false },
})
defineEmits(['click'])

const meta = computed(() => {
  if (props.item.note) return props.item.note
  return props.showDate ? friendlyDate(props.item.date) : ''
})
</script>

<style scoped>
.rec {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  cursor: pointer;
}
.rec + .rec {
  border-top: 1px solid var(--c-line);
}
.rec:active {
  opacity: 0.65;
}

.rec__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.rec__name {
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text);
}
.rec__note {
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rec__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.rec__amount {
  font-size: 15px;
  font-weight: 600;
}
.rec__date {
  font-size: 11px;
  color: var(--c-text-3);
}
</style>
