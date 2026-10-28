<template>
  <div class="stats">
    <header class="head">
      <div class="head__top">
        <MonthSwitcher :label="monthLabel(month)" @pick="showMonthPicker = true" />
        <span class="head__tip">花钱有数，心里不慌</span>
      </div>

      <!-- 月度汇总 -->
      <section class="summary">
        <span class="summary__label">本月结余</span>
        <span class="summary__value num" :class="{ 'is-negative': (data.balance || 0) < 0 }">
          ¥{{ money(data.balance || 0) }}
        </span>
        <div class="summary__row">
          <div class="summary__item">
            <span>收入</span>
            <b class="num text-income">¥{{ money(data.income || 0) }}</b>
          </div>
          <div class="summary__divider" />
          <div class="summary__item">
            <span>支出</span>
            <b class="num text-expense">¥{{ money(data.expense || 0) }}</b>
          </div>
        </div>
      </section>
    </header>

    <!-- 支出构成 -->
    <SectionCard title="支出构成">
      <template #extra>
        <span class="section__extra">{{ data.expenseCount || 0 }} 笔支出</span>
      </template>
      <div v-if="expenseList.length" class="pie">
        <!-- 点环上的扇区或右侧图例，都跳到「该分类 + 本月」的账单列表 -->
        <div class="pie__ring" :style="{ background: pieGradient }" @click="onRingClick($event)">
          <div class="pie__hole">
            <span class="pie__hole-label">支出</span>
            <span class="pie__hole-value num">¥{{ compact(data.expense || 0) }}</span>
          </div>
        </div>
        <div class="pie__legend">
          <button
            v-for="item in expenseList"
            :key="item.categoryId"
            type="button"
            class="legend"
            @click="goCategory(item)"
          >
            <span class="legend__dot" :style="{ background: item.categoryColor }" />
            <span class="legend__name">{{ item.categoryName }}</span>
            <span class="legend__pct num">{{ item.percent }}%</span>
            <span class="legend__amount num">¥{{ money(item.amount) }}</span>
          </button>
        </div>
      </div>
      <EmptyState v-else emoji="🍃" text="这个月还没有支出记录" />
    </SectionCard>

    <!-- 每日支出趋势 -->
    <SectionCard v-if="expenseList.length" title="每日支出">
      <template #extra>
        <span class="section__extra">日均 ¥{{ money(data.dailyAverage || 0) }}</span>
      </template>
      <div class="daily">
        <div class="daily__chart">
          <div v-for="d in data.daily || []" :key="d.date" class="daily__col">
            <!-- 点某一天 → 只看这天的账单；没有支出的那天不可点 -->
            <button
              type="button"
              class="daily__bar"
              :class="{ 'daily__bar--empty': !d.expense }"
              :style="{ height: barHeightOf(d.expense) + '%' }"
              :disabled="!d.expense"
              :title="`${d.day}日`"
              @click="goDay(d)"
            />
          </div>
        </div>
        <div class="daily__labels">
          <span>1日</span>
          <span>{{ data.daysInMonth }}日</span>
        </div>
      </div>
    </SectionCard>

    <!-- 收入构成 -->
    <SectionCard v-if="incomeList.length" title="收入来源">
      <div
        v-for="item in incomeList"
        :key="item.categoryId"
        class="legend legend--full"
      >
        <span class="legend__dot" :style="{ background: item.categoryColor }" />
        <span class="legend__name">{{ item.categoryName }}</span>
        <span class="legend__pct num">{{ item.percent }}%</span>
        <span class="legend__amount num text-income">+{{ money(item.amount) }}</span>
      </div>
    </SectionCard>

    <!-- 关键数字 -->
    <SectionCard title="这个月">
      <div class="metrics">
        <div class="metric">
          <span class="metric__value num">{{ data.recordCount || 0 }}</span>
          <span class="metric__label">总笔数</span>
        </div>
        <div class="metric">
          <span class="metric__value num">{{ data.daysWithRecord || 0 }}</span>
          <span class="metric__label">记账天数</span>
        </div>
        <div class="metric">
          <span class="metric__value num">¥{{ money(data.dailyAverage || 0) }}</span>
          <span class="metric__label">日均支出</span>
        </div>
      </div>
    </SectionCard>

    <section v-if="data.biggestExpense" class="section">
      <div class="card biggest">
        <span class="biggest__tag">最大单笔</span>
        <span class="biggest__name">{{ data.biggestExpense.categoryName }}</span>
        <span class="biggest__amount num text-expense">
          ¥{{ money(data.biggestExpense.amount) }}
        </span>
      </div>
    </section>

    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        title="选择月份"
        @cancel="showMonthPicker = false"
        @confirm="onMonthConfirm"
      />
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { statsApi } from '@/api'
import { money, monthLabel, recentMonths, currentMonthStr } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import SectionCard from '@/components/SectionCard.vue'

const router = useRouter()

const month = ref(currentMonthStr())
const data = ref({})
const showMonthPicker = ref(false)
const loading = ref(false)

const monthColumns = computed(() => recentMonths(24).map((m) => ({ text: monthLabel(m), value: m })))
const expenseList = computed(() => data.value.expenseByCategory || [])
const incomeList = computed(() => data.value.incomeByCategory || [])

/**
 * 用 conic-gradient 画环形图。
 * 好处是不引入图表库，移动端体积小；分类数一般不超过 10 个，视觉上也够用。
 */
const pieGradient = computed(() => {
  const list = expenseList.value
  if (!list.length) return 'var(--c-track)'
  let acc = 0
  const stops = list.map((item) => {
    const start = acc
    acc += item.percent
    return `${item.categoryColor} ${start}% ${Math.min(acc, 100)}%`
  })
  return `conic-gradient(${stops.join(', ')})`
})

function compact(cents) {
  const yuan = (Number(cents) || 0) / 100
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(1)}万`
  return Math.round(yuan)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 点分类 → 账单页只看「该分类 + 本月」的支出 */
function goCategory(item) {
  if (!item?.categoryId) return
  router.push({ path: '/records', query: { month: month.value, categoryId: item.categoryId } })
}

/** 点每日柱 → 只看那一天的账单（开始与结束日期相同） */
function goDay(day) {
  if (!day?.date) return
  router.push({
    path: '/records',
    query: { month: month.value, startDate: day.date, endDate: day.date },
  })
}

/**
 * 点环形图的扇区。
 *
 * 这里刻意不用 event.offsetX/offsetY：环中间那个洞（.pie__hole）是绝对定位的子元素，
 * 点在中心附近时事件目标是它，offsetX/offsetY 就变成相对那个子元素的了，算出的角度是错的。
 * 用 clientX/clientY 减去环自身的中心点才是稳的。
 */
function onRingClick(event) {
  const list = expenseList.value
  if (!list.length) return
  const rect = event.currentTarget.getBoundingClientRect()
  const cx = rect.width / 2
  const cy = rect.height / 2
  const dx = event.clientX - rect.left - cx
  const dy = event.clientY - rect.top - cy
  const radius = Math.hypot(dx, dy)

  // 点在中心的洞或环外就不响应
  const outer = rect.width / 2
  const inner = outer - 22 // 与 .pie__hole 的 inset 保持一致
  if (radius < inner || radius > outer + 6) return

  // conic-gradient 从 12 点方向开始顺时针铺，atan2 也从 12 点方向起算
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI
  if (angle < 0) angle += 360

  let acc = 0
  const hit = list.find((item) => {
    const start = acc
    acc += item.percent
    return angle >= start && angle < acc
  })
  if (hit) goCategory(hit)
}

function onMonthConfirm({ selectedOptions }) {
  month.value = selectedOptions[0].value
  showMonthPicker.value = false
}

/** 每日柱高按当月最大单日支出归一 */
function barHeightOf(value) {
  const list = data.value.daily || []
  const max = Math.max(1, ...list.map((d) => d.expense))
  return Math.max(2, Math.round((value / max) * 100))
}

async function load() {
  loading.value = true
  try {
    data.value = await statsApi.summary({ month: month.value })
  } catch (err) {
    showToast(err.message || '加载失败')
  } finally {
    loading.value = false
  }
}

watch(month, load)
onMounted(load)
</script>

<style scoped>
.stats {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(24px + var(--safe-bottom));
  background: var(--c-bg);
}

/* ---------- 顶部白色汇总区 ---------- */
.head {
  padding: calc(16px + var(--safe-top)) 20px 20px;
  background: var(--c-card);
  border-radius: 0 0 var(--r-xl) var(--r-xl);
  box-shadow: var(--shadow-sm);
}
.head__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head__tip {
  font-size: 12px;
  color: var(--c-text-3);
}

.summary {
  display: block;
  margin-top: 20px;
}
.summary__label {
  font-size: 12px;
  color: var(--c-text-3);
}
.summary__value {
  display: block;
  margin-top: 4px;
  font-size: var(--fs-hero);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.5px;
  color: var(--c-text);
}
.summary__value.is-negative {
  color: var(--c-expense);
}
.summary__row {
  display: flex;
  align-items: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--c-line);
}
.summary__item {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.summary__item span {
  font-size: 11px;
  color: var(--c-text-3);
}
.summary__item b {
  font-size: 15px;
  font-weight: 600;
}
.summary__divider {
  width: 1px;
  height: 26px;
  background: var(--c-line);
}

.section__extra {
  font-size: 11px;
  color: var(--c-text-3);
}

/* ---------- 环形图 ---------- */
.pie {
  display: flex;
  align-items: center;
  gap: 14px;
}
.pie__ring {
  position: relative;
  flex-shrink: 0;
  width: 118px;
  height: 118px;
  border-radius: 50%;
  cursor: pointer;
}
.pie__hole {
  position: absolute;
  inset: 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--c-card);
}
.pie__hole-label {
  font-size: 11px;
  color: var(--c-text-3);
}
.pie__hole-value {
  font-size: 15px;
  font-weight: 700;
}
.pie__legend {
  display: flex;
  flex: 1;
  min-width: 0;
  max-height: 170px;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.legend {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  margin: 0 -4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.legend:active {
  background: var(--c-bg);
}
.legend--full {
  margin: 0;
  padding: 8px 0;
  border-radius: 0;
  cursor: default;
}
.legend--full + .legend--full {
  border-top: 1px solid var(--c-line);
}
.legend__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.legend__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend__pct {
  width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--c-text-3);
}
.legend__amount {
  min-width: 62px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
}

/* ---------- 每日柱状 ---------- */
.daily {
  padding-top: 4px;
}
.daily__chart {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 96px;
}
.daily__col {
  display: flex;
  flex: 1;
  align-items: flex-end;
  height: 100%;
}
.daily__bar {
  width: 100%;
  min-height: 2px;
  padding: 0;
  border: none;
  border-radius: 4px 4px 0 0;
  background: var(--c-primary);
  transition: height 0.3s;
  cursor: pointer;
}
.daily__bar:disabled {
  cursor: default;
}
.daily__bar--empty {
  background: var(--c-track);
}
.daily__labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  color: var(--c-text-3);
}

/* ---------- 关键数字 ---------- */
.metrics {
  display: flex;
}
.metric {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.metric + .metric {
  border-left: 1px solid var(--c-line);
}
.metric__value {
  font-size: 17px;
  font-weight: 700;
}
.metric__label {
  font-size: 11px;
  color: var(--c-text-3);
}

.biggest {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
}
.biggest__tag {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--c-warning-light);
  color: var(--c-warning);
  font-size: 11px;
}
.biggest__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.biggest__amount {
  font-weight: 600;
}
</style>
