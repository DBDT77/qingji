<template>
  <div class="layer-chart">
    <div ref="elRef" class="layer-chart__canvas" />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps({
  /** [{ key, label, count }]，把用户按累计记账笔数分档 */
  data: { type: Array, default: () => [] },
  /** 是否可点击下钻：开启后条块显示手型光标，点击 emit('select') */
  clickable: { type: Boolean, default: false },
})

const emit = defineEmits(['select'])

const elRef = ref(null)
let chart = null
let ro = null

const cssVar = (name, fallback) => {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * 序列是按 props.data 倒序画的（让「从未记账」排在最上面），
 * 所以 echarts 给的 dataIndex 不能直接当成 props.data 的下标，
 * 必须反过来取。tooltip 和点击都用这个函数，避免两处各写一遍再写错。
 */
function itemAt(dataIndex) {
  const list = props.data || []
  return list[list.length - 1 - dataIndex] || {}
}

function buildOption() {
  const list = props.data || []
  const lineColor = cssVar('--c-line', '#eff0f2')
  const gridColor = cssVar('--c-chart-grid', '#eceef0')
  const textColor = cssVar('--c-text-3', '#9aa0a8')
  const inkColor = cssVar('--c-text', '#1c1f22')
  const cardColor = cssVar('--c-card', '#ffffff')
  const primary = cssVar('--c-primary', '#12b886')
  const warning = cssVar('--c-warning', '#e8930c')
  const total = list.reduce((a, d) => a + d.count, 0)

  // 从未记账的用警示色点出来 —— 那才是真正要关注的一档
  const colorOf = (key) => (key === 'never' ? warning : primary)

  return {
    animationDuration: 420,
    grid: { left: 6, right: 34, top: 10, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      backgroundColor: cardColor,
      borderColor: lineColor,
      textStyle: { color: inkColor, fontSize: 12 },
      extraCssText:
        'box-shadow: 0 8px 24px rgba(20,24,28,.10); border-radius: 10px; padding: 8px 10px;',
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        // 曾经这里写的是 list[p.dataIndex]，因为序列倒着画，取到的是错的档位
        const item = itemAt(p.dataIndex)
        const pct = total > 0 ? Math.round(((item.count || 0) / total) * 100) : 0
        const hint = props.clickable ? '<br/><span style="opacity:.6">点击查看这批用户</span>' : ''
        return `${p.marker}${item.label}：${item.count} 人（${pct}%）${hint}`
      },
    },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridColor, type: 'solid' } },
    },
    yAxis: {
      // 倒序显示，让「从未记账」排在最上面
      type: 'category',
      data: [...list].reverse().map((d) => d.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: inkColor, fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        data: [...list].reverse().map((d) => ({
          value: d.count,
          itemStyle: { color: colorOf(d.key) },
        })),
        barMaxWidth: 16,
        itemStyle: { borderRadius: [0, 6, 6, 0] },
        cursor: props.clickable ? 'pointer' : 'default',
        // 人数直接标在条尾，读者不必对着轴估长度
        label: {
          show: true,
          position: 'right',
          formatter: '{c} 人',
          fontSize: 11,
          color: inkColor,
        },
      },
    ],
  }
}

function render() {
  if (!chart || !(props.data || []).length) return
  chart.setOption(buildOption(), { notMerge: true })
}

/** 点击条块 → 抛出选中的档位。只在 onMounted 注册一次，避免叠加监听器 */
function onClick(params) {
  if (!props.clickable) return
  const item = itemAt(params.dataIndex)
  if (!item.key) return
  emit('select', { key: item.key, label: item.label, count: item.count })
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

watch(() => props.data, render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize)
  ro?.disconnect()
  ro = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.layer-chart {
  padding: 6px 0 0;
}
.layer-chart__canvas {
  width: 100%;
  height: 170px;
}
</style>
