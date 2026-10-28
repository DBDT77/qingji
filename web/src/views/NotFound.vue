<template>
  <div class="notfound">
    <div class="notfound__mark">
      <BrandMark :size="56" />
    </div>
    <h3 class="notfound__title">页面找不到了</h3>
    <p class="notfound__desc">你访问的地址不存在，或者它已经被移走了。</p>
    <van-button round type="primary" @click="$router.replace('/home')">回到首页</van-button>
  </div>
</template>

<script setup>
import BrandMark from '@/components/BrandMark.vue'
// 兜底页：路由未匹配时显示，避免用户看到空白页面
</script>

<style scoped>
.notfound {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 28px;
  text-align: center;
  background: var(--c-bg);
}
.notfound__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 84px;
  height: 84px;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--c-primary-light);
}
.notfound__title {
  margin: 0;
  font-size: 18px;
  color: var(--c-text);
}
.notfound__desc {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--c-text-3);
}
</style>
