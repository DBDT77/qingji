<template>
  <div class="app-shell">
    <router-view v-slot="{ Component, route }">
      <transition :name="route.meta.tab ? 'none' : 'fade-slide'" mode="out-in">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>

    <!-- 底部导航：仅在主 Tab 页面显示，记账页和详情页不显示以免打扰 -->
    <van-tabbar
      v-if="showTabbar"
      v-model="activeTab"
      route
      safe-area-inset-bottom
      placeholder
    >
      <van-tabbar-item to="/home" name="home" icon="home-o">首页</van-tabbar-item>
      <van-tabbar-item to="/records" name="records" icon="orders-o">账单</van-tabbar-item>
      <!-- 占位槽：让中间凸起的记账按钮正好落在 tabbar 正中 -->
      <div class="tabbar-gap" />
      <van-tabbar-item to="/stats" name="stats" icon="bar-chart-o">统计</van-tabbar-item>
      <van-tabbar-item to="/mine" name="mine" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>

    <!-- 记账按钮：整站最显眼的操作，任何主 Tab 页都能一键记账 -->
    <button v-if="showTabbar" class="tabbar-add" type="button" @click="goRecord">
      <van-icon name="plus" size="24" />
    </button>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const showTabbar = computed(() => Boolean(route.meta.tab))
const activeTab = ref(route.meta.tab || 'home')

function goRecord() {
  router.push('/record/new')
}

watch(
  () => route.meta.tab,
  (tab) => {
    if (tab) activeTab.value = tab
  },
)
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
}

/* 中间占位槽：与 van-tabbar-item 同样是 flex:1，把 4 个 tab 均分并把记账按钮顶到正中 */
.tabbar-gap {
  flex: 1;
}

/* 凸起的记账按钮：盖住 tabbar，但低于 Vant 弹层（popup ≈ 2000+） */
.tabbar-add {
  position: fixed;
  left: 50%;
  bottom: calc(24px + var(--safe-bottom));
  transform: translateX(-50%);
  z-index: 100;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 4px solid var(--c-card);
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-fab);
  transition: transform 0.12s ease;
}
.tabbar-add:active {
  transform: translateX(-50%) scale(0.92);
}
</style>
