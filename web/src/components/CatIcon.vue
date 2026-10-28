<template>
  <span class="cat-icon" :style="style">{{ icon }}</span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  icon: { type: String, default: '🏷️' },
  color: { type: String, default: '#8C8C8C' },
  size: { type: Number, default: 40 },
})

const style = computed(() => ({
  background: hexToRgba(props.color, 0.1),
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.5)}px`,
  borderRadius: `${Math.round(props.size * 0.32)}px`,
}))

/** #12B886 -> rgba(18,184,134,0.10)，让分类色以浅底呈现，避免整页花哨 */
function hexToRgba(hex, alpha) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
  if (!match) return `rgba(140,140,140,${alpha})`
  const [r, g, b] = match.slice(1).map((h) => Number.parseInt(h, 16))
  return `rgba(${r},${g},${b},${alpha})`
}
</script>
