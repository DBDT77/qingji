<template>
  <div class="empty">
    <span class="empty__emoji">{{ emoji }}</span>
    <p class="empty__text">{{ text }}</p>
    <van-button v-if="actionText" size="small" round type="primary" plain @click="$emit('action')">
      {{ actionText }}
    </van-button>
  </div>
</template>

<script setup>
defineProps({
  emoji: { type: String, default: '🧾' },
  text: { type: String, default: '这里还什么都没有' },
  actionText: { type: String, default: '' },
})
defineEmits(['action'])
</script>
