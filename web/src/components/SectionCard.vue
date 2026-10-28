<template>
  <section class="section">
    <div class="section__head">
      <h2 class="section__title">
        {{ title }}
        <span v-if="hint" class="section__hint">{{ hint }}</span>
      </h2>
      <div class="section__right">
        <slot name="extra" />
        <button v-if="more" class="section__more" type="button" @click="$emit('more')">
          {{ more }}
          <van-icon name="arrow" size="11" />
        </button>
      </div>
    </div>
    <div class="card section__card">
      <slot />
    </div>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  more: { type: String, default: '' },
  hint: { type: String, default: '' },
})
defineEmits(['more'])
</script>

<style scoped>
.section__right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.section__hint {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--c-text-3);
}
.section__more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--c-text-3);
}
.section__more:active {
  color: var(--c-primary-dark);
}
.section__card {
  padding: 14px 16px;
}
</style>
