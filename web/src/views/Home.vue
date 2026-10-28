<template>
  <div class="home">
    <div class="home__top">
      <!-- 顶部：问候 + 月份切换 + 预算入口 -->
      <header class="home__head">
        <div class="home__greet">
          <p class="home__hello">{{ greeting }}，{{ userStore.nickname }}</p>
        </div>
        <div class="home__tools">
          <MonthSwitcher :label="monthLabel(month)" @pick="showMonthPicker = true" />
          <button
            class="home__gear"
            type="button"
            aria-label="预算设置"
            @click="$router.push('/budget')"
          >
            <van-icon name="setting-o" size="19" />
          </button>
        </div>
      </header>

      <!-- 主数字：本月支出。结余是"结果"，用户打开 App 更想先看"这个月花了多少" -->
      <section class="balance">
        <p class="balance__label">{{ isThisMonth ? '本月支出' : `${monthLabel(month)}支出` }}</p>
        <p class="balance__value num">
          ¥{{ money(overview.expense || 0) }}
        </p>
        <div class="balance__row">
          <div class="balance__item">
            <span class="balance__dot balance__dot--in" />收入
            <b class="num text-income">¥{{ money(overview.income || 0) }}</b>
          </div>
          <div class="balance__item">
            <span class="balance__dot balance__dot--neutral" />{{ isThisMonth ? '本月结余' : '结余' }}
            <b class="num" :class="balanceClass">
              {{ balance < 0 ? '-' : '' }}¥{{ money(Math.abs(balance)) }}
            </b>
          </div>
        </div>
        <div class="balance__foot">
          <span>{{ overview.recordCount || 0 }} 笔记录</span>
          <span v-if="isThisMonth">日均支出 ¥{{ money(overview.dailyAverage || 0) }}</span>
        </div>
      </section>

      <div class="quick-actions">
        <button
          class="quick-action quick-action--expense"
          type="button"
          @click="$router.push({ path: '/record/new', query: { type: 'expense' } })"
        >
          <van-icon name="minus" size="17" />
          <span>记支出</span>
        </button>
        <button
          class="quick-action quick-action--income"
          type="button"
          @click="$router.push({ path: '/record/new', query: { type: 'income' } })"
        >
          <van-icon name="plus" size="17" />
          <span>记收入</span>
        </button>
      </div>

      <button class="ai-entry" type="button" @click="showAi = true">
        <span class="ai-entry__badge">AI</span>
        <span class="ai-entry__title">一句话记多笔</span>
        <span class="ai-entry__hint">试试「昨天午饭 35，打车 22」</span>
        <van-icon name="arrow" size="12" />
      </button>
    </div>

    <!-- 预算进度 -->
    <section class="section">
      <div class="card budget" @click="$router.push('/budget')">
        <template v-if="budget.amount !== null">
          <div class="budget__top">
            <span class="budget__title">本月预算</span>
            <span class="budget__state" :class="`is-${budget.status}`">{{ budgetText }}</span>
          </div>
          <van-progress
            :percentage="Math.min(budget.percent || 0, 100)"
            :color="progressColor"
            :show-pivot="false"
            stroke-width="7"
            track-color="var(--c-track)"
            class="budget__bar"
          />
          <div class="budget__nums">
            <span>已用 ¥{{ money(budget.spent) }} / ¥{{ money(budget.amount) }}</span>
            <span class="num" :style="{ color: progressColor }">{{ budget.percent }}%</span>
          </div>
        </template>
        <template v-else>
          <div class="budget__empty">
            <span class="budget__title">本月还没设置预算</span>
            <span class="budget__set">去设置 <van-icon name="arrow" size="12" /></span>
          </div>
        </template>
      </div>
    </section>

    <!-- 近 12 个月收支：统一 Y 轴，柱子之间可横向比较；点柱子看那个月的账单 -->
    <SectionCard
      v-if="overview.trend?.length"
      title="近 12 个月收支"
      more="详细统计"
      @more="$router.push('/stats')"
    >
      <div class="trend">
        <div class="trend__legend">
          <span><i class="trend__dot trend__dot--in" />收入</span>
          <span><i class="trend__dot trend__dot--out" />支出</span>
          <span class="trend__legend-hint">点柱子看明细</span>
        </div>
        <TrendChart
          :data="overview.trend"
          :active-month="month"
          clickable
          @select="onTrendSelect"
        />
      </div>
    </SectionCard>

    <!-- 支出 TOP3：点一行看该分类在这个月的全部账单 -->
    <SectionCard v-if="overview.topExpense?.length" title="花得最多的" hint="点一行看明细">
      <div class="top-list">
        <div
          v-for="(item, i) in overview.topExpense"
          :key="item.categoryId"
          class="top-item"
          @click="goCategory(item.categoryId)"
        >
          <span class="top-item__rank">{{ i + 1 }}</span>
          <CatIcon :icon="item.categoryIcon" :color="item.categoryColor" :size="34" />
          <div class="top-item__main">
            <div class="top-item__line">
              <span class="top-item__name">{{ item.categoryName }}</span>
              <span class="top-item__amount num">¥{{ money(item.amount) }}</span>
            </div>
            <div class="top-item__track">
              <div
                class="top-item__fill"
                :style="{ width: `${item.percent}%`, background: item.categoryColor }"
              />
            </div>
          </div>
          <span class="top-item__pct num">{{ item.percent }}%</span>
          <van-icon name="arrow" size="12" class="top-item__arrow" />
        </div>
      </div>
    </SectionCard>

    <!-- 最近记录 -->
    <SectionCard title="最近记录" more="全部账单" @more="$router.push('/records')">
      <div v-if="overview.recent?.length" class="recent">
        <TransactionRow
          v-for="item in overview.recent"
          :key="recordKey(item)"
          :item="item"
          show-date
          @click="$router.push(`/record/${item.id}/edit`)"
        />
      </div>
      <EmptyState
        v-else
        emoji="🪄"
        :text="`${monthLabel(month)}还没有记录`"
        action-text="记第一笔"
        @action="$router.push('/record/new')"
      />
    </SectionCard>

    <!-- 月份选择 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        :model-value="[month]"
        title="选择月份"
        @cancel="showMonthPicker = false"
        @confirm="onMonthConfirm"
      />
    </van-popup>

    <AiAssistant v-model:show="showAi" @saved="load" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { statsApi } from '@/api'
import { useUserStore } from '@/store/user'
import { money, monthLabel, recentMonths, currentMonthStr } from '@/utils/format'
import AiAssistant from '@/components/AiAssistant.vue'
import CatIcon from '@/components/CatIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import SectionCard from '@/components/SectionCard.vue'
import TransactionRow from '@/components/TransactionRow.vue'
import TrendChart from '@/components/TrendChart.vue'

const userStore = useUserStore()
const route = useRoute()
const router = useRouter()
const month = ref(currentMonth())
const overview = ref({})
const showMonthPicker = ref(false)
const showAi = ref(false)
const loading = ref(true)

/** 统一用 format.js 的 currentMonthStr，避免各处自己拼月份出现偏差 */
function currentMonth() {
  return currentMonthStr()
}

const monthColumns = computed(() =>
  recentMonths(18).map((m) => ({ text: monthLabel(m), value: m })),
)

function onMonthConfirm({ selectedOptions }) {
  month.value = selectedOptions[0].value
  showMonthPicker.value = false
}

// isThisMonth 以服务端返回的为准（backend 已按真实当前月算过），无数据时回退本地判断
const isThisMonth = computed(() =>
  overview.value.isCurrentMonth !== undefined
    ? overview.value.isCurrentMonth
    : month.value === currentMonth(),
)
const balance = computed(() => overview.value.balance || 0)
const balanceClass = computed(() => (balance.value < 0 ? 'is-negative' : ''))
const budget = computed(() => overview.value.budget || { amount: null, status: 'unset' })

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

/** 趋势柱点击：点到哪个月就跳去看那个月的账单 */
function onTrendSelect(payload) {
  if (payload?.month) goMonth(payload.month)
}

const budgetText = computed(() => {
  const map = {
    normal: '预算充足',
    warning: '接近预算上限',
    reached: '刚好用完',
    exceeded: '已超支',
    unset: '未设置',
  }
  return map[budget.value.status] || '预算充足'
})

const progressColor = computed(() => {
  const map = {
    normal: '#12B886',
    warning: '#E8930C',
    reached: '#E8930C',
    exceeded: '#F0435B',
  }
  return map[budget.value.status] || '#12B886'
})

function recordKey(item) {
  return `${item.id}-${item.date}`
}

/** 点趋势柱 → 看那个月的账单（下钻到账单页，不带筛选条件） */
function goMonth(target) {
  router.push({ path: '/records', query: { month: target } })
}

/** 点支出分类 → 账单页按该分类 + 当前月份过滤 */
function goCategory(categoryId) {
  router.push({ path: '/records', query: { month: month.value, categoryId } })
}

async function load() {
  loading.value = true
  try {
    overview.value = await statsApi.overview({ month: month.value })
  } catch (err) {
    showToast(err.message || '加载失败')
  } finally {
    loading.value = false
  }
}

watch(month, load)
watch(
  () => route.fullPath,
  () => {
    // 从记账页返回时刷新，保证刚记的一笔立刻出现在首页
    if (route.name === 'home') load()
  },
)
load()
</script>

<style scoped>
.home {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(24px + var(--safe-bottom));
  background: var(--c-bg);
}

/* ---------- 顶部白色概览区 ---------- */
.home__top {
  padding: calc(18px + var(--safe-top)) 20px 20px;
  background: var(--c-card);
  border-radius: 0 0 var(--r-xl) var(--r-xl);
  box-shadow: var(--shadow-sm);
}
.home__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.home__greet {
  min-width: 0;
}
.home__hello {
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home__tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.home__gear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--c-bg);
  color: var(--c-text-2);
}
.home__gear:active {
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
}

.balance {
  margin-top: 22px;
}
.balance__label {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-3);
}
.balance__value {
  margin: 4px 0 14px;
  font-size: var(--fs-display);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.5px;
  color: var(--c-text);
}
.balance__row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
.balance__item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--c-text-3);
}
.balance__item b {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}
.balance__item b.is-negative {
  color: var(--c-expense);
}
.balance__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.balance__dot--in {
  background: var(--c-income);
}
.balance__dot--neutral {
  background: var(--c-text-3);
}
.balance__foot {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  font-size: 11px;
  color: var(--c-text-3);
}

.quick-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
.quick-action {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 46px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  font-size: 14px;
  font-weight: 600;
  transition: transform 0.12s ease;
}
.quick-action:active {
  transform: scale(0.98);
}
.quick-action--expense {
  background: var(--c-expense-light);
  color: var(--c-expense);
}
.quick-action--income {
  background: var(--c-income-light);
  color: var(--c-income);
}

/* ---------- AI 记账入口 ---------- */
.ai-entry {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  text-align: left;
}
.ai-entry:active {
  opacity: 0.8;
}
.ai-entry__badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--c-primary);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}
.ai-entry__title {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
}
.ai-entry__hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 预算 ---------- */
.budget {
  padding: 14px 16px 16px;
}
.budget__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.budget__title {
  font-size: 14px;
  font-weight: 600;
}
.budget__state {
  padding: 3px 9px;
  border-radius: var(--r-pill);
  font-size: 11px;
}
.budget__state.is-normal {
  color: var(--c-primary-dark);
  background: var(--c-primary-light);
}
.budget__state.is-warning,
.budget__state.is-reached {
  color: var(--c-warning);
  background: var(--c-warning-light);
}
.budget__state.is-exceeded {
  color: var(--c-expense);
  background: var(--c-expense-light);
}
.budget__bar {
  margin: 12px 0 8px;
}
.budget__nums {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--c-text-3);
}
.budget__nums .num {
  font-weight: 600;
}
.budget__empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.budget__set {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-primary-dark);
}

/* ---------- 趋势 ---------- */
.trend__legend {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--c-text-3);
}
.trend__legend-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--c-text-3);
}
.trend__dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 50%;
}
.trend__dot--in {
  background: var(--c-chart-income);
}
.trend__dot--out {
  background: var(--c-chart-expense);
}

/* ---------- TOP3 ---------- */
.top-list {
  display: flex;
  flex-direction: column;
}
.top-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  cursor: pointer;
}
.top-item + .top-item {
  border-top: 1px solid var(--c-line);
}
.top-item:active {
  opacity: 0.65;
}
.top-item__rank {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-bg);
  color: var(--c-text-3);
  font-size: 11px;
  font-weight: 600;
}
.top-item__main {
  flex: 1;
  min-width: 0;
}
.top-item__line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}
.top-item__name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.top-item__amount {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
}
.top-item__track {
  height: 4px;
  overflow: hidden;
  border-radius: var(--r-pill);
  background: var(--c-track);
}
.top-item__fill {
  height: 100%;
  border-radius: var(--r-pill);
  transition: width 0.4s ease;
}
.top-item__pct {
  width: 40px;
  text-align: right;
  font-size: 11px;
  color: var(--c-text-3);
}
.top-item__arrow {
  flex-shrink: 0;
  color: var(--c-text-3);
}

/* ---------- 最近记录 ---------- */
.recent {
  margin-top: -2px;
}
</style>
