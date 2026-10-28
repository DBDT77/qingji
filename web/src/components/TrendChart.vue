<template>
  <div class="trend-chart">
    <div ref="elRef" class="trend-chart__canvas" :style="{ height: `${height}px` }" />
    <!-- 进行中月份脚注：当月的柱子天然比往月矮，不说明会被误读成"这个月省了" -->
    <p v-if="runningMonth" class="trend-chart__note">
      ＊{{ Number(runningMonth.slice(5)) }}月进行中，数据截至 {{ runningDay }} 日
    </p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { money, currentMonthStr } from '@/utils/format'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const emit = defineEmits(['select'])

const props = defineProps({
  /** [{ month: '2026-10', income: <分>, expense: <分> }]，金额是「分」，内部统一转元 */
  data: { type: Array, default: () => [] },
  /** 是否可点击下钻：开启后柱子显示手型光标，点击 emit('select') */
  clickable: { type: Boolean, default: false },
  /** 当前选中的月份，落在图内则高亮；不在图内（历史月）则不高亮 */
  activeMonth: { type: String, default: '' },
  /**
   * 'income-expense'（默认）：收入/支出双柱，金额单位「分」，走金额轴；
   * 'count'：两个名为 counts 的计数序列，不按金额处理。
   */
  variant: { type: String, default: 'income-expense' },
  /** 双序列的图例名与取值字段，便于复用到「新增用户/累计用户」等场景 */
  seriesNames: { type: Array, default: () => ['收入', '支出'] },
  seriesColors: { type: Array, default: () => [] },
  dataKeys: { type: Array, default: () => ['income', 'expense'] },
  /** 单位：'money' 走金额轴与 ¥ tooltip；'count' 走「笔/个」 */
  unit: { type: String, default: 'money' },
  /** x 轴是否为月份（决定标签的「N月」格式与进行中脚注） */
  monthly: { type: Boolean, default: true },
  height: { type: Number, default: 190 },
})

const elRef = ref(null)
let chart = null
let ro = null

const cssVar = (name, fallback) => {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const yuan = (cents) => Number(cents || 0) / 100

/** 向上取「整数感」的刻度上限，避免 Y 轴出现 18650 这种刻度 */
function niceMax(value) {
  if (!(value > 0)) return 100
  const mag = 10 ** Math.floor(Math.log10(value))
  const n = value / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * mag
}

/** 万以上压缩显示，移动端 Y 轴标签不至于太长 */
function axisMoney(value) {
  if (value >= 10000) return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}万`
  return String(value)
}

/** 按单位格式化刻度：金额走万元压缩，计数原样 */
function axisLabelOf(value) {
  return props.unit === 'money' ? axisMoney(value) : String(value)
}

const months = computed(() => props.data || [])
const runningMonth = computed(() => {
  if (!props.monthly) return ''
  const list = months.value
  if (!list.length) return ''
  const last = list[list.length - 1]?.month
  return last === currentMonthStr() ? last : ''
})
const runningDay = new Date().getDate()

/** 高亮月只在图内才生效：trend 固定是「最近 N 个月」，与用户选中的月份无关 */
const highlight = computed(() => {
  const list = months.value
  if (!list.some((m) => m.month === props.activeMonth)) return ''
  return props.activeMonth
})

/** 取出某个序列的值：金额型先由分转元，计数型原样 */
function seriesValues(rows, key) {
  return rows.map((row) => (props.unit === 'money' ? yuan(row[key]) : Number(row[key] || 0)))
}

/** x 轴标签：月份显示「N月」，必要时给进行中的当月加 * */
function axisLabels(list) {
  return list.map((row, i) => {
    const label = props.monthly ? `${Number(String(row.month).slice(5))}月` : String(row.label ?? '')
    const isRunning = runningMonth.value && i === list.length - 1
    return isRunning ? `${label}*` : label
  })
}

function buildOption() {
  const list = months.value
  const lineColor = cssVar('--c-line', '#eff0f2')
  const gridColor = cssVar('--c-chart-grid', '#eceef0')
  const textColor = cssVar('--c-text-3', '#9aa0a8')
  const inkColor = cssVar('--c-text', '#1c1f22')
  const cardColor = cssVar('--c-card', '#ffffff')

  const defaults = ['--c-chart-income', '--c-chart-expense']
  const fallbacks = ['#0e9fb8', '#f0435b']
  const colors = props.seriesNames.map((_, si) => {
    if (props.seriesColors[si]) return props.seriesColors[si]
    return cssVar(defaults[si] || defaults[0], fallbacks[si] || fallbacks[0])
  })

  const keys = props.dataKeys
  const series = keys.map((k) => seriesValues(list, k))
  const max = niceMax(Math.max(0, ...series.flat()))

  const hlIndex = list.findIndex((m) => m.month === highlight.value)
  // 未过完的当月天然矮一截，整组降透明度；选中的月份整组加深 —— 比画底带更不干扰读数
  const barOpacity = (i) => {
    if (hlIndex >= 0 && i === hlIndex) return 1
    if (runningMonth.value && i === list.length - 1) return 0.55
    if (hlIndex >= 0) return 0.65
    return 1
  }

  // 只为高亮月的柱子做直接标注，其余数值交给 tooltip —— 每条都标会糊成一片
  const labelFor = () => ({
    show: true,
    position: 'top',
    formatter: (p) => (p.dataIndex === hlIndex ? axisLabelOf(p.value) : ''),
    fontSize: 10,
    color: inkColor,
  })

  return {
    animationDuration: 420,
    grid: { left: 6, right: 10, top: 26, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      backgroundColor: cardColor,
      borderColor: lineColor,
      textStyle: { color: inkColor, fontSize: 12 },
      extraCssText:
        'box-shadow: 0 8px 24px rgba(20,24,28,.10); border-radius: 10px; padding: 8px 10px;',
      // 直接读 params 里的序列名与值，不再假设一定是「收入/支出」这一对
      formatter: (params) => {
        const rows = Array.isArray(params) ? params : [params]
        const head = props.monthly
          ? `${Number(String(list[rows[0]?.dataIndex]?.month).slice(5))}月`
          : String(list[rows[0]?.dataIndex]?.label ?? '')
        const lines = rows.map((p) => {
          const v = props.unit === 'money' ? `¥${money(p.value * 100)}` : `${p.value}`
          return `${p.marker}${p.seriesName} ${v}`
        })
        // 金额型顺带给出结余，计数型没有「结余」概念
        if (props.unit === 'money' && rows.length === 2) {
          const bal = Number(rows[0].value) - Number(rows[1].value)
          lines.push(`结余 ${bal < 0 ? '-' : ''}¥${money(Math.abs(bal) * 100)}`)
        }
        return [head, ...lines].join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      data: axisLabels(list),
      axisLine: { lineStyle: { color: lineColor } },
      axisTick: { show: false },
      // 月份多的时候强制全显示会糊成一片（12 个月挤在 200px 里）。
      // echarts 的 'auto' 会按容器宽度自己抽稀，短数据时依然每根都标。
      axisLabel: { color: textColor, fontSize: 11, interval: list.length > 8 ? 'auto' : 0 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 11, formatter: axisLabelOf },
      splitLine: { lineStyle: { color: gridColor, type: 'solid' } },
    },
    series: keys.map((key, si) => ({
      name: props.seriesNames[si] || key,
      type: 'bar',
      data: series[si].map((v, i) => ({ value: v, itemStyle: { opacity: barOpacity(i) } })),
      barMaxWidth: 12,
      barGap: si === 0 ? '30%' : undefined,
      itemStyle: { color: colors[si], borderRadius: [6, 6, 0, 0] },
      label: labelFor(),
      // 手型光标是唯一的「这里能点」的提示，不加用户不会想到去点图
      cursor: props.clickable ? 'pointer' : 'default',
    })),
  }
}

/** 容器尺寸为 0 时 init 会报警告（e2e 会当作控制台报错），故等下一帧再初始化 */
function render() {
  if (!chart || !months.value.length) return
  chart.setOption(buildOption(), { notMerge: true })
}

/**
 * 点击柱子 → 抛出选中的月份与序列。
 * 注意：这个监听只能在 onMounted 里注册一次。render() 由 deep watcher 反复触发，
 * 若在其中 chart.on('click') 会不断叠加监听器，点一下跳转好几次。
 */
function onClick(params) {
  if (!props.clickable) return
  const row = months.value[params.dataIndex]
  if (!row) return
  emit('select', {
    dataIndex: params.dataIndex,
    month: row.month,
    label: row.label ?? row.month,
    seriesKey: props.dataKeys[params.seriesIndex],
    seriesName: params.seriesName,
    value: params.value,
  })
}

onMounted(async () => {
  await new Promise((r) => requestAnimationFrame(r))
  if (!elRef.value) return
  chart = echarts.init(elRef.value)
  chart.on('click', onClick)
  render()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(elRef.value)
  }
  window.addEventListener('resize', onWinResize)
})

function onWinResize() {
  chart?.resize()
}

watch(() => [props.data, props.activeMonth], render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize)
  ro?.disconnect()
  ro = null
  // App.vue 用 <component :key="route.path"> 会重建页面，不 dispose 会泄漏 canvas
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.trend-chart {
  padding: 12px 0 2px;
}
.trend-chart__canvas {
  width: 100%;
  height: 190px;
}
.trend-chart__note {
  margin: 6px 2px 0;
  font-size: 11px;
  color: var(--c-text-3);
}
</style>
