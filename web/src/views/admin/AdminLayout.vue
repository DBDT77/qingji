<template>
  <div class="admin">
    <van-nav-bar
      :title="route.meta.title || '管理后台'"
      left-arrow
      fixed
      placeholder
      safe-area-inset-top
      left-text="返回"
      @click-left="$router.push('/mine')"
    />

    <div class="admin__body">
      <router-view />
    </div>

    <van-tabbar route safe-area-inset-bottom>
      <van-tabbar-item to="/admin/dashboard" icon="chart-trending-o">总览</van-tabbar-item>
      <van-tabbar-item to="/admin/users" icon="friends-o">用户</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<style scoped>
.admin {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--c-bg);
  padding-bottom: calc(60px + var(--safe-bottom));
}
.admin__body {
  padding: 12px 16px 20px;
}
</style>
