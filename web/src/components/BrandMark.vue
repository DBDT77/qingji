<template>
  <svg
    class="brand-mark"
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <rect width="48" height="48" rx="14" fill="var(--c-primary)" />
    <path
      d="M16 15h16M16 21h16M24 15v19M18 26l6 6 6-6"
      stroke="#fff"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup>
defineProps({
  size: { type: Number, default: 44 },
})
</script>

<style scoped>
.brand-mark {
  display: block;
  flex-shrink: 0;
}
</style>
