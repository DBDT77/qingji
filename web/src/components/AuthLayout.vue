<template>
  <div class="auth">
    <div class="auth__wash" />

    <button
      v-if="back"
      class="auth__back"
      type="button"
      aria-label="返回"
      @click="goBack"
    >
      <van-icon name="arrow-left" size="20" />
    </button>

    <div class="auth__brand">
      <div class="auth__logo">
        <BrandMark :size="52" />
      </div>
      <h1 class="auth__title">
        <slot name="title">{{ title }}</slot>
      </h1>
      <p v-if="slogan" class="auth__slogan">{{ slogan }}</p>
    </div>

    <div class="auth__card">
      <slot />
    </div>

    <div v-if="$slots.foot" class="auth__foot">
      <slot name="foot" />
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import BrandMark from './BrandMark.vue'

defineProps({
  title: { type: String, default: '' },
  slogan: { type: String, default: '' },
  back: { type: Boolean, default: false },
})

const router = useRouter()

function goBack() {
  router.back()
}
</script>

<style scoped>
.auth {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  padding: calc(40px + var(--safe-top)) 20px calc(28px + var(--safe-bottom));
  background: var(--c-bg);
}

/* 极淡的青绿光晕，替代旧版的整块渐变 */
.auth__wash {
  position: absolute;
  inset: 0 0 auto 0;
  height: 260px;
  background: radial-gradient(120% 80% at 50% 0%, rgba(18, 184, 134, 0.14), transparent 70%);
  pointer-events: none;
}

.auth__back {
  position: absolute;
  top: calc(12px + var(--safe-top));
  left: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--c-text-2);
}
.auth__back:active {
  background: var(--c-primary-light);
}

.auth__brand {
  position: relative;
  padding-top: 18px;
  text-align: center;
}
.auth__logo {
  display: flex;
  justify-content: center;
  margin-bottom: 14px;
}
.auth__title {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--c-text);
}
.auth__slogan {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.auth__card {
  position: relative;
  margin-top: 26px;
  padding: 20px;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-md);
}

.auth__card :deep(.van-field) {
  padding: 14px 0;
}
.auth__card :deep(.van-field__label) {
  width: 64px;
  font-weight: 500;
  color: var(--c-text-2);
}
.auth__card :deep(.van-cell::after) {
  left: 0;
  right: 0;
  border-color: var(--c-line);
}

.auth__foot {
  margin-top: 24px;
}

@media (max-width: 360px) {
  .auth {
    padding-left: 14px;
    padding-right: 14px;
  }
}
</style>
