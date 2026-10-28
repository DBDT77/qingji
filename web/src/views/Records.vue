<template>
  <div class="records">
    <!-- 顶部：月份 + 收入/支出/结余小结 -->
    <header class="head">
      <div class="head__bar">
        <MonthSwitcher :label="headerLabel" @pick="showMonthPicker = true" />
        <button
          class="head__icon"
          type="button"
          aria-label="搜索"
          @click="showSearch = true"
        >
          <van-icon name="search" size="19" />
        </button>
      </div>
      <!-- 从图表点进来的日期区间：表头三数只统计这段区间，避免与列表对不上 -->
      <p v-if="dateRangeLabel" class="head__scope">仅统计 {{ dateRangeLabel }}</p>
      <div class="head__stats">
        <div class="head__stat">
          <span>收入</span>
          <b class="num text-income">¥{{ money(summary.income || 0) }}</b>
        </div>
        <div class="head__stat">
          <span>支出</span>
          <b class="num text-expense">¥{{ money(summary.expense || 0) }}</b>
        </div>
        <div class="head__stat">
          <span>结余</span>
          <b class="num">¥{{ money(summary.balance || 0) }}</b>
        </div>
      </div>
    </header>

    <!-- 筛选条 -->
    <div class="filters">
      <button
        v-for="f in typeFilters"
        :key="f.value"
        type="button"
        class="chip filters__item"
        :class="{ 'is-active': type === f.value }"
        @click="type = f.value"
      >
        {{ f.label }}
      </button>
      <button
        type="button"
        class="chip filters__item filters__cat"
        :class="{ 'is-active': categoryId }"
        @click="showCatFilter = true"
      >
        {{ activeCategoryName }}
        <van-icon name="arrow-down" size="11" />
      </button>
      <button
        v-if="keyword"
        type="button"
        class="chip filters__item is-active"
        @click="keyword = ''"
      >
        “{{ keyword }}” <van-icon name="cross" size="11" />
      </button>
      <button
        v-if="dateRangeLabel"
        type="button"
        class="chip filters__item is-active"
        @click="clearDateRange"
      >
        {{ dateRangeLabel }} <van-icon name="cross" size="11" />
      </button>
    </div>

    <!-- 记录列表，按日期分组 -->
    <div v-if="groups.length" class="list">
      <div v-for="group in groups" :key="group.date" class="group">
        <div class="group__head">
          <span>{{ friendlyDate(group.date) }}</span>
          <span class="num">
            支出 ¥{{ money(group.expense) }} · 收入 ¥{{ money(group.income) }}
          </span>
        </div>
        <div class="group__card">
          <TransactionRow
            v-for="item in group.items"
            :key="item.id"
            :item="item"
            @click="$router.push(`/record/${item.id}/edit`)"
          />
        </div>
      </div>

      <div class="list__more">
        <span v-if="loading">加载中...</span>
        <span v-else-if="!hasMore">— 已经到底啦 —</span>
      </div>
    </div>

    <EmptyState
      v-else-if="!loading"
      emoji="🔍"
      :text="hasFilter ? '没有符合条件的记录' : `${monthLabel(month)}还没有记录`"
      :action-text="hasFilter ? '清空筛选' : '记一笔'"
      @action="hasFilter ? clearFilters() : $router.push('/record/new')"
    />

    <!-- 月份选择 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        title="选择月份"
        @cancel="showMonthPicker = false"
        @confirm="onMonthConfirm"
      />
    </van-popup>

    <!-- 分类筛选 -->
    <van-popup v-model:show="showCatFilter" position="bottom" round>
      <div class="catfilter">
        <p class="catfilter__title">按分类筛选</p>
        <div class="catfilter__grid">
          <button
            type="button"
            class="catfilter__item"
            :class="{ 'is-active': !categoryId }"
            @click="pickCategory(null)"
          >
            全部
          </button>
          <button
            v-for="c in filterCategories"
            :key="c.id"
            type="button"
            class="catfilter__item"
            :class="{ 'is-active': categoryId === c.id }"
            @click="pickCategory(c.id)"
          >
            {{ c.icon }} {{ c.name }}
          </button>
        </div>
      </div>
    </van-popup>

    <!-- 搜索备注 / 分类名 -->
    <van-popup v-model:show="showSearch" position="top">
      <div class="search">
        <van-field
          v-model="searchInput"
          placeholder="搜索备注或分类"
          clearable
          autofocus
          @keyup.enter="applySearch"
        >
          <template #button>
            <van-button size="small" round type="primary" @click="applySearch">搜索</van-button>
          </template>
        </van-field>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { categoryApi, recordApi, statsApi } from '@/api'
import { friendlyDate, money, monthLabel, recentMonths, currentMonthStr } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import TransactionRow from '@/components/TransactionRow.vue'

const route = useRoute()
const router = useRouter()

const month = ref(currentMonthStr())
const type = ref('') // '' | 'income' | 'expense'
const categoryId = ref(null)
const keyword = ref('')
// 单日 / 区间下钻（统计页点每日柱、或从别处带过来）
const startDate = ref('')
const endDate = ref('')

const showMonthPicker = ref(false)
const showCatFilter = ref(false)
const showSearch = ref(false)
const searchInput = ref('')

const records = ref([])
const summary = ref({})
const allCategories = ref([])
const loading = ref(false)
const hasMore = ref(true)
let page = 1
const pageSize = 30

const typeFilters = [
  { label: '全部', value: '' },
  { label: '支出', value: 'expense' },
  { label: '收入', value: 'income' },
]

const monthColumns = computed(() => recentMonths(24).map((m) => ({ text: monthLabel(m), value: m })))
const filterCategories = computed(() =>
  type.value ? allCategories.value.filter((c) => c.type === type.value) : allCategories.value,
)
const activeCategoryName = computed(() => {
  const c = allCategories.value.find((x) => x.id === categoryId.value)
  return c ? `${c.icon} ${c.name}` : '分类'
})
const hasFilter = computed(() =>
  Boolean(type.value || categoryId.value || keyword.value || startDate.value || endDate.value),
)

/** 日期区间的可读文案：单日显示「9月12日」，区间显示「X 至 Y」 */
const dateRangeLabel = computed(() => {
  if (!startDate.value && !endDate.value) return ''
  if (startDate.value && startDate.value === endDate.value) return friendlyDate(startDate.value)
  const from = startDate.value ? friendlyDate(startDate.value) : '最早'
  const to = endDate.value ? friendlyDate(endDate.value) : '今天'
  return `${from} 至 ${to}`
})

/** 表头标题：没选日期区间时显示月份 */
const headerLabel = computed(() => (dateRangeLabel.value ? dateRangeLabel.value : monthLabel(month.value)))

/** 按日期分组，便于列表阅读（同一天的收入支出归在一起） */
const groups = computed(() => {
  const map = new Map()
  for (const item of records.value) {
    if (!map.has(item.date)) map.set(item.date, { date: item.date, items: [], income: 0, expense: 0 })
    const group = map.get(item.date)
    group.items.push(item)
    if (item.type === 'income') group.income += item.amount
    else group.expense += item.amount
  }
  return [...map.values()]
})

function onMonthConfirm({ selectedOptions }) {
  month.value = selectedOptions[0].value
  showMonthPicker.value = false
}

function pickCategory(id) {
  categoryId.value = id
  showCatFilter.value = false
}

function applySearch() {
  keyword.value = searchInput.value.trim()
  showSearch.value = false
}

function clearDateRange() {
  startDate.value = ''
  endDate.value = ''
}

function clearFilters() {
  type.value = ''
  categoryId.value = null
  keyword.value = ''
  searchInput.value = ''
  clearDateRange()
  // 筛选可能来自 URL（从图表点进来的）。只清本地状态会留下地址栏参数，
  // 刷新一下筛选又回来了 —— 顺带把 query 里这几个键去掉。
  const query = { ...route.query }
  for (const key of ['type', 'categoryId', 'keyword', 'startDate', 'endDate']) delete query[key]
  router.replace({ path: route.path, query })
}

/**
 * 用 URL 上的参数覆盖当前筛选。
 * 这是「图表点击下钻」能生效的关键：App.vue 的 router-view 是按 route.path 做 key 的，
 * 从 /records?month=A 跳到 /records?month=B 路径没变，组件**不会**重建，
 * 所以只能在 watch(route.query) 里同步，靠 onMounted 读一次是不够的。
 */
function syncFromQuery() {
  const q = route.query
  const next = {
    month: q.month ? String(q.month) : currentMonthStr(),
    type: q.type ? String(q.type) : '',
    categoryId: q.categoryId ? Number(q.categoryId) : null,
    keyword: q.keyword ? String(q.keyword) : '',
    startDate: q.startDate ? String(q.startDate) : '',
    endDate: q.endDate ? String(q.endDate) : '',
  }
  // 返回是否真的改了 —— 调用方据此决定要不要补一次加载：
  // 改了会触发下面的筛选 watcher，没改就得自己拉
  const changed =
    next.month !== month.value ||
    next.type !== type.value ||
    next.categoryId !== categoryId.value ||
    next.keyword !== keyword.value ||
    next.startDate !== startDate.value ||
    next.endDate !== endDate.value

  month.value = next.month
  type.value = next.type
  categoryId.value = next.categoryId
  keyword.value = next.keyword
  startDate.value = next.startDate
  endDate.value = next.endDate
  searchInput.value = keyword.value
  return changed
}

async function fetchSummary() {
  const params = { month: month.value }
  // 有日期区间时表头只统计这段区间，否则会和列表里的条数对不上
  if (startDate.value) params.startDate = startDate.value
  if (endDate.value) params.endDate = endDate.value
  summary.value = await statsApi.summary(params)
}

/**
 * 每次请求带一个递增序号，回来时只有最新那次才允许写结果。
 *
 * 不加这个会真的重复渲染：onMounted 里 syncFromQuery() 改筛选 ref 会触发筛选
 * watcher 拉一次，紧随其后的显式 fetchRecords(true) 又拉一次。两次请求交错时
 * 谁先回来不定，而 page === 1 的判断各自成立，于是后回来的那次把数据**追加**
 * 到了前一次的列表后面 —— 同一条记录在页面上出现两遍，表头金额和列表条数对不上。
 */
let reqSeq = 0

async function fetchRecords(reset = false) {
  if (reset) {
    page = 1
    records.value = []
    hasMore.value = true
  }
  if (!hasMore.value) return

  const seq = ++reqSeq
  const reqPage = page
  loading.value = true
  try {
    const params = { month: month.value, page: reqPage, pageSize }
    if (type.value) params.type = type.value
    if (categoryId.value) params.categoryId = categoryId.value
    if (keyword.value) params.keyword = keyword.value
    if (startDate.value) params.startDate = startDate.value
    if (endDate.value) params.endDate = endDate.value

    const res = await recordApi.list(params)
    // 已有更新的请求在跑或已回来 → 本次结果作废
    if (seq !== reqSeq) return
    // 首屏直接用返回的数据；后续分页追加，避免重复渲染
    records.value = reqPage === 1 ? res.items : [...records.value, ...res.items]
    hasMore.value = records.value.length < res.total
    page = reqPage + 1
  } catch (err) {
    if (seq !== reqSeq) return
    showToast(err.message || '加载失败')
  } finally {
    if (seq === reqSeq) loading.value = false
  }
}

function onScroll() {
  if (loading.value || !hasMore.value) return
  const nearBottom =
    window.innerHeight + window.scrollY >= document.body.offsetHeight - 240
  if (nearBottom) fetchRecords()
}

/** 切换类型后，若已选分类的类型对不上，就清掉筛选，否则会筛出空列表 */
function normalizeCategoryFilter() {
  if (!categoryId.value) return
  const cat = allCategories.value.find((c) => c.id === categoryId.value)
  if (!cat || (type.value && cat.type !== type.value)) categoryId.value = null
}

watch([month, type, categoryId, keyword, startDate, endDate], async () => {
  normalizeCategoryFilter()
  await Promise.all([fetchSummary(), fetchRecords(true)])
})

// URL 参数变了就重新同步筛选并拉数据。
// App.vue 的 router-view key 是 route.path，同一路径只变 query 时组件不会重建，
// 所以「图表点击下钻」全靠这个 watch 生效。
watch(
  () => route.query,
  async (query) => {
    // 用户在本页手动改筛选时也会写回 URL，避免自己触发一次多余刷新
    const next = {
      month: query.month ? String(query.month) : currentMonthStr(),
      type: query.type ? String(query.type) : '',
      categoryId: query.categoryId ? Number(query.categoryId) : null,
      keyword: query.keyword ? String(query.keyword) : '',
      startDate: query.startDate ? String(query.startDate) : '',
      endDate: query.endDate ? String(query.endDate) : '',
    }
    const same =
      next.month === month.value &&
      next.type === type.value &&
      next.categoryId === categoryId.value &&
      next.keyword === keyword.value &&
      next.startDate === startDate.value &&
      next.endDate === endDate.value
    if (same) return
    syncFromQuery()
  },
)

onMounted(async () => {
  // 分类用于筛选弹层；拉取失败也不该阻断列表展示
  allCategories.value = await categoryApi.list().catch(() => [])
  // 先把 URL 参数灌进筛选 ref。改了就由上面的筛选 watcher 负责加载，
  // 没改（首次进入且 URL 无参数）才在这里显式拉一次 —— 两边都拉就会重复。
  if (!syncFromQuery()) {
    await Promise.all([fetchSummary(), fetchRecords(true)])
  }
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<style scoped>
.records {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(24px + var(--safe-bottom));
  background: var(--c-bg);
}

/* ---------- 顶部 ---------- */
.head {
  padding: calc(16px + var(--safe-top)) 20px 18px;
  background: var(--c-card);
  border-radius: 0 0 var(--r-xl) var(--r-xl);
  box-shadow: var(--shadow-sm);
}
.head__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head__scope {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}
.head__icon {
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
.head__icon:active {
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
}
.head__stats {
  display: flex;
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: var(--r-md);
  background: var(--c-bg);
}
.head__stat {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.head__stat span {
  font-size: 11px;
  color: var(--c-text-3);
}
.head__stat b {
  font-size: 17px;
  font-weight: 600;
  color: var(--c-text);
}

/* ---------- 筛选 ---------- */
.filters {
  display: flex;
  gap: 8px;
  padding: 12px 16px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.filters::-webkit-scrollbar {
  display: none;
}
.filters__item {
  flex-shrink: 0;
}
.filters__item.is-active {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
}

/* ---------- 列表 ---------- */
.list {
  padding: 8px 16px 0;
}
.group {
  margin-bottom: 12px;
}
.group__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 2px 8px;
  font-size: 12px;
  color: var(--c-text-3);
}
.group__card {
  padding: 2px 16px;
  background: var(--c-card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
}
.list__more {
  padding: 14px 0 4px;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}

/* ---------- 分类筛选弹层 ---------- */
.catfilter {
  padding: 20px 16px calc(24px + var(--safe-bottom));
}
.catfilter__title {
  margin: 0 0 14px;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
}
.catfilter__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.catfilter__item {
  padding: 10px 4px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-sm);
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 13px;
}
.catfilter__item.is-active {
  border-color: var(--c-primary);
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-weight: 600;
}

/* ---------- 搜索弹层 ---------- */
.search {
  padding: calc(8px + var(--safe-top)) 12px 8px;
  background: var(--c-card);
}
</style>
