<template>
  <button
    v-if="mode === 'picker'"
    class="month-pill"
    type="button"
    aria-label="切换月份"
    @click="$emit('pick')"
  >
    <span>{{ label }}</span>
    <van-icon name="arrow-down" size="11" />
  </button>

  <div v-else class="month-arrows">
    <button class="month-arrow" type="button" aria-label="上个月" @click="$emit('prev')">
      <van-icon name="arrow-left" size="16" />
    </button>
    <span class="month-label">{{ label }}</span>
    <button
      class="month-arrow"
      :class="{ 'is-disabled': future }"
      type="button"
      aria-label="下个月"
      :disabled="future"
      @click="$emit('next')"
    >
      <van-icon name="arrow" size="16" />
    </button>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  mode: { type: String, default: 'picker' },
  future: { type: Boolean, default: false },
})
defineEmits(['pick', 'prev', 'next'])
</script>

<style scoped>
.month-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-pill);
  background: var(--c-card);
  color: var(--c-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.month-pill .van-icon {
  color: var(--c-text-3);
}
.month-pill:active {
  background: var(--c-primary-light);
  border-color: var(--c-primary);
}

.month-arrows {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.month-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--c-card);
  color: var(--c-text-2);
  box-shadow: var(--shadow-sm);
}
.month-arrow:active {
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
}
.month-arrow.is-disabled {
  opacity: 0.3;
}
.month-label {
  min-width: 104px;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--c-text);
}
</style>
