<template>
  <div class="dash">
    <!-- 核心指标 -->
    <div class="kpi">
      <div class="kpi__card kpi__card--main">
        <span>注册用户</span>
        <b class="num">{{ data.userCount || 0 }}</b>
        <em>{{ data.activeUserCount || 0 }} 个正常 / {{ data.disabledUserCount || 0 }} 个停用</em>
      </div>
      <div class="kpi__row">
        <div class="kpi__card">
          <span>记账记录</span>
          <b class="num">{{ data.recordCount || 0 }}</b>
        </div>
        <div class="kpi__card">
          <span>本月活跃</span>
          <b class="num">{{ data.monthActiveUsers || 0 }}</b>
        </div>
      </div>
      <div class="kpi__row">
        <div class="kpi__card">
          <span>分类数</span>
          <b class="num">{{ data.categoryCount || 0 }}</b>
        </div>
        <div class="kpi__card">
          <span>预算数</span>
          <b class="num">{{ data.budgetCount || 0 }}</b>
        </div>
      </div>
    </div>

    <!-- 全站金额 -->
    <div class="card money">
      <p class="money__title">全站金额规模</p>
      <div class="money__row">
        <div>
          <span>累计收入</span>
          <b class="num text-income">¥{{ money(data.totalIncome || 0) }}</b>
        </div>
        <div>
          <span>累计支出</span>
          <b class="num text-expense">¥{{ money(data.totalExpense || 0) }}</b>
        </div>
      </div>
      <div class="money__month">
        <span>本月支出</span>
        <b class="num">¥{{ money(data.monthExpense || 0) }}</b>
        <span class="money__dot" />
        <span>本月收入</span>
        <b class="num">¥{{ money(data.monthIncome || 0) }}</b>
      </div>
    </div>

    <!-- 用户增长：每月新增注册，点柱子看该月注册的用户 -->
    <div class="card">
      <div class="card__head">
        <p class="money__title">新增用户</p>
        <span class="muted card__note">近 12 个月 · 累计 {{ growthTotal }} 位</span>
      </div>
      <TrendChart
        v-if="growth.length"
        :data="growth"
        :series-names="['新增']"
        :data-keys="['added']"
        unit="count"
        clickable
        :series-colors="[cssPrimary]"
        :height="170"
        @select="onGrowthSelect"
      />
    </div>

    <!-- 活跃度：每月记账人数 + 笔数，点柱子看该月有记账的用户 -->
    <div class="card">
      <div class="card__head">
        <p class="money__title">记账活跃度</p>
        <span class="muted card__note">近 12 个月</span>
      </div>
      <div class="legend">
        <span><i class="legend__dot legend__dot--user" />记账人数</span>
        <span><i class="legend__dot legend__dot--rec" />记录笔数</span>
      </div>
      <TrendChart
        v-if="activity.length"
        :data="activity"
        :series-names="['记账人数', '记录笔数']"
        :data-keys="['activeUsers', 'recordCount']"
        unit="count"
        clickable
        :series-colors="[cssPrimary, cssWarning]"
        :height="170"
        @select="onActivitySelect"
      />
    </div>

    <!-- 全站收支趋势：接口早已提供，此前一直没接上 -->
    <div class="card">
      <div class="card__head">
        <p class="money__title">全站收支趋势</p>
        <span class="muted card__note">近 12 个月</span>
      </div>
      <div class="legend">
        <span><i class="legend__dot legend__dot--in" />收入</span>
        <span><i class="legend__dot legend__dot--out" />支出</span>
      </div>
      <TrendChart
        v-if="serverTrend.length"
        :data="serverTrend"
        :height="170"
        clickable
        @select="onTrendSelect"
      />
    </div>

    <!-- 用户活跃分层：一眼看出有多少人注册后就没再用；点条块筛出这批用户 -->
    <div class="card">
      <div class="card__head">
        <p class="money__title">用户活跃分层</p>
        <span class="muted card__note">共 {{ layerTotal }} 位普通用户</span>
      </div>
      <LayerChart v-if="layers.length" :data="layers" clickable @select="onLayerSelect" />
      <EmptyState v-else emoji="👥" text="暂无用户数据" />
    </div>

    <!-- 记账排行榜 -->
    <div class="card">
      <div class="card__head">
        <p class="money__title">记账排行榜</p>
        <div class="switch">
          <button
            type="button"
            :class="{ 'is-active': rankBy === 'records' }"
            @click="rankBy = 'records'"
          >
            笔数
          </button>
          <button
            type="button"
            :class="{ 'is-active': rankBy === 'expense' }"
            @click="rankBy = 'expense'"
          >
            支出
          </button>
        </div>
      </div>
      <div v-for="(u, i) in ranking" :key="u.id" class="rank">
        <span class="rank__no" :class="{ 'is-top': i < 3 }">{{ i + 1 }}</span>
        <div class="rank__main">
          <span class="rank__name">{{ u.nickname }}</span>
          <span class="rank__email">@{{ u.username }}</span>
        </div>
        <span class="rank__value num">
          {{ rankBy === 'expense' ? `¥${money(u.totalExpense || 0)}` : `${u.recordCount} 笔` }}
        </span>
      </div>
      <EmptyState v-if="!ranking.length" emoji="📊" text="暂无排行数据" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { adminApi } from '@/api'
import { money } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'
import TrendChart from '@/components/TrendChart.vue'
import LayerChart from '@/components/LayerChart.vue'

const router = useRouter()

const data = ref({})
const growth = ref([])
const activity = ref([])
const layers = ref([])
/** 全站收支趋势（接口早已提供，此前前端一直没接上） */
const serverTrend = ref([])
const ranking = ref([])
const rankBy = ref('records')

const layerTotal = computed(() => layers.value.reduce((a, d) => a + d.count, 0))
const growthTotal = computed(() => growth.value.at(-1)?.cumulative ?? 0)

// 图表配色取自主题变量，避免把色值写死在模板里
const cssVar = (name, fallback) =>
  typeof window === 'undefined'
    ? fallback
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
const cssPrimary = cssVar('--c-primary', '#12b886')
const cssWarning = cssVar('--c-warning', '#e8930c')

async function loadOverview() {
  data.value = await adminApi.overview()
}

async function loadCharts() {
  const [g, a, l, c] = await Promise.all([
    adminApi.growth({ months: 12 }),
    adminApi.activity({ months: 12 }),
    adminApi.layers(),
    adminApi.charts({ months: 12 }),
  ])
  growth.value = g
  activity.value = a
  layers.value = l
  serverTrend.value = c
}

/**
 * 图表点击 → 下钻到用户管理页，并按对应的条件筛选。
 * 三张图分别落到「注册月份 / 该月有记账 / 活跃档位」三种筛选上。
 */
function goUsers(query) {
  router.push({ path: '/admin/users', query })
}
function onGrowthSelect(payload) {
  if (payload?.month) goUsers({ createdMonth: payload.month })
}
function onActivitySelect(payload) {
  if (payload?.month) goUsers({ activeMonth: payload.month })
}
function onLayerSelect(payload) {
  if (payload?.key) goUsers({ layer: payload.key })
}
/** 全站收支趋势：后台没有跨用户账单页，点月份看该月的全站数据即可 */
function onTrendSelect(payload) {
  if (payload?.month) goUsers({ activeMonth: payload.month })
}

async function loadRanking() {
  ranking.value = await adminApi.ranking({ by: rankBy.value })
}

watch(rankBy, loadRanking)

onMounted(async () => {
  try {
    await Promise.all([loadOverview(), loadCharts(), loadRanking()])
  } catch (err) {
    showToast(err.message || '加载失败')
  }
})
</script>

<style scoped>
.dash {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---------- KPI ---------- */
.kpi {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.kpi__row {
  display: flex;
  gap: 10px;
}
.kpi__card {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.kpi__card span {
  font-size: 12px;
  color: var(--c-text-3);
}
.kpi__card b {
  font-size: 24px;
  font-weight: 700;
  color: var(--c-text);
}
.kpi__card em {
  font-size: 11px;
  font-style: normal;
  color: var(--c-text-3);
}
.kpi__card--main {
  background: var(--c-primary-light);
}
.kpi__card--main span,
.kpi__card--main em {
  color: var(--c-primary-dark);
  opacity: 0.75;
}
.kpi__card--main b {
  font-size: 32px;
  color: var(--c-primary-dark);
}

/* ---------- 金额 ---------- */
.money__title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.money__row {
  display: flex;
  gap: 10px;
}
.money__row > div {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  padding: 12px 14px;
  border-radius: var(--r-md);
}
.money__row > div:first-child {
  background: var(--c-income-light);
}
.money__row > div:last-child {
  background: var(--c-expense-light);
}
.money__row span {
  font-size: 11px;
  color: var(--c-text-3);
}
.money__row b {
  font-size: 17px;
}
.money__month {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 12px;
  color: var(--c-text-3);
}
.money__month b {
  font-size: 14px;
  color: var(--c-text);
}
.money__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--c-line);
}

/* ---------- 卡片标题 / 图例 ---------- */
.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.card__note {
  font-size: 11px;
}
.legend {
  display: flex;
  gap: 16px;
  margin-bottom: 2px;
  font-size: 12px;
  color: var(--c-text-3);
}
.legend__dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 50%;
}
.legend__dot--user {
  background: var(--c-primary);
}
.legend__dot--rec {
  background: var(--c-warning);
}
.legend__dot--in {
  background: var(--c-chart-income);
}
.legend__dot--out {
  background: var(--c-chart-expense);
}

/* ---------- 排行 ---------- */
.switch {
  display: flex;
  padding: 2px;
  border-radius: var(--r-pill);
  background: var(--c-bg);
}
.switch button {
  padding: 4px 12px;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--c-text-3);
  font-size: 12px;
}
.switch button.is-active {
  background: var(--c-card);
  color: var(--c-primary-dark);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
.rank {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
}
.rank + .rank {
  border-top: 1px solid var(--c-line);
}
.rank__no {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-bg);
  color: var(--c-text-3);
  font-size: 11px;
  font-weight: 700;
}
.rank__no.is-top {
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
}
.rank__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.rank__name {
  font-size: 14px;
  font-weight: 500;
}
.rank__email {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank__value {
  font-size: 14px;
  font-weight: 600;
}
</style>
