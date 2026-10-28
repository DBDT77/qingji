<template>
  <div class="budget-page">
    <van-nav-bar
      title="月度预算"
      left-arrow
      fixed
      placeholder
      safe-area-inset-top
      @click-left="$router.back()"
    />

    <!-- 月份切换 -->
    <div class="monthbar">
      <MonthSwitcher
        mode="arrows"
        :label="monthLabel(month)"
        :future="isFutureMonth(month)"
        @prev="changeMonth(-1)"
        @next="changeMonth(1)"
      />
    </div>

    <!-- 预算状态 -->
    <div class="overview" :class="`is-${state.status}`">
      <template v-if="state.amount !== null">
        <p class="overview__label">{{ statusText }}</p>
        <p class="overview__value num">
          {{ state.remaining >= 0 ? '还可花' : '已超支' }}
          ¥{{ money(Math.abs(state.remaining || 0)) }}
        </p>
        <van-progress
          :percentage="Math.min(state.percent || 0, 100)"
          :color="progressColor"
          :show-pivot="false"
          stroke-width="8"
          track-color="var(--c-track)"
          class="overview__bar"
        />
        <div class="overview__nums">
          <span>已支出 ¥{{ money(state.spent || 0) }}</span>
          <span>预算 ¥{{ money(state.amount) }}</span>
        </div>
      </template>
      <template v-else>
        <p class="overview__label">本月还没有设置预算</p>
        <p class="overview__value">给这个月定个花钱上限</p>
        <p class="overview__hint">
          已支出 ¥{{ money(state.spent || 0) }}，设置后可以随时看到剩余额度。
        </p>
      </template>
    </div>

    <!-- 设置 / 修改 -->
    <div class="card setter">
      <p class="setter__title">{{ state.amount !== null ? '调整预算' : '设置预算' }}</p>

      <div class="setter__quick">
        <button
          v-for="amount in quickAmounts"
          :key="amount"
          type="button"
          class="chip setter__chip"
          :class="{ 'is-active': Number(input) === amount }"
          @click="pickQuick(amount)"
        >
          ¥{{ amount >= 10000 ? `${amount / 10000}万` : amount }}
        </button>
      </div>

      <van-field
        v-model="input"
        label="金额"
        type="text"
        inputmode="decimal"
        placeholder="请输入本月支出预算"
        clearable
        @update:model-value="onInput"
      />

      <p v-if="error" class="setter__error">{{ error }}</p>

      <van-button block round type="primary" :loading="saving" class="setter__btn" @click="save">
        {{ state.amount !== null ? '保存修改' : '设置预算' }}
      </van-button>
      <van-button
        v-if="state.amount !== null"
        block
        round
        plain
        class="setter__btn"
        @click="clearBudget"
      >
        取消本月预算
      </van-button>
    </div>

    <p class="foot">
      预算按月独立设置。支出达到预算的 80% 会提醒你，超支后首页会标红。
    </p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { budgetApi } from '@/api'
import { currentMonthStr, isFutureMonth, money, monthLabel, shiftMonth } from '@/utils/format'
import MonthSwitcher from '@/components/MonthSwitcher.vue'

const month = ref(currentMonthStr())
const state = ref({ month: month.value, amount: null, spent: 0, remaining: null, percent: null, status: 'unset' })
const input = ref('')
const error = ref('')
const saving = ref(false)

const quickAmounts = [1000, 2000, 3000, 5000, 8000, 10000]

const statusText = computed(
  () =>
    ({
      normal: '预算充足，继续保持',
      warning: '快接近预算上限了',
      reached: '刚好花完预算',
      exceeded: '已经超出预算啦',
    })[state.value.status] || '预算充足',
)

/** 进度条颜色跟随状态：正常青绿、预警琥珀、超支珊瑚红 */
const progressColor = computed(() => {
  if (state.value.status === 'exceeded') return '#F0435B'
  if (state.value.status === 'warning' || state.value.status === 'reached') return '#E8930C'
  return '#12B886'
})

function onInput(value) {
  let v = String(value || '').replace(/[^\d.]/g, '')
  const parts = v.split('.')
  if (parts.length > 2) v = `${parts[0]}.${parts.slice(1).join('')}`
  if (v.includes('.')) {
    const [intPart, dec = ''] = v.split('.')
    v = `${intPart.slice(0, 8)}.${dec.slice(0, 2)}`
  } else {
    v = v.slice(0, 8)
  }
  input.value = v
  error.value = ''
}

function pickQuick(amount) {
  input.value = String(amount)
  error.value = ''
}

function changeMonth(offset) {
  const next = shiftMonth(month.value, offset)
  if (isFutureMonth(next)) {
    showToast('还没有到那个月呢')
    return
  }
  month.value = next
}

async function load() {
  try {
    state.value = await budgetApi.get(month.value)
    input.value = state.value.amount !== null ? String(state.value.amount / 100) : ''
    error.value = ''
  } catch (err) {
    showToast(err.message || '加载失败')
  }
}

async function save() {
  error.value = ''
  if (!input.value) {
    error.value = '请输入预算金额'
    return
  }
  if (!/^\d+(\.\d{1,2})?$/.test(input.value)) {
    error.value = '请输入正确的金额，最多两位小数'
    return
  }
  saving.value = true
  try {
    state.value = await budgetApi.set({ month: month.value, amount: input.value })
    showToast({ type: 'success', message: '预算已保存' })
  } catch (err) {
    showToast(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function clearBudget() {
  try {
    await showConfirmDialog({
      title: '取消预算',
      message: '取消后本月将不再显示预算进度，确定吗？',
      confirmButtonText: '取消预算',
      confirmButtonColor: '#F0435B',
    })
  } catch {
    return
  }
  try {
    state.value = await budgetApi.remove(month.value)
    input.value = ''
    showToast({ type: 'success', message: '已取消预算' })
  } catch (err) {
    showToast(err.message || '操作失败')
  }
}

watch(month, load)
onMounted(load)
</script>

<style scoped>
.budget-page {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(24px + var(--safe-bottom));
  background: var(--c-bg);
}

.monthbar {
  display: flex;
  justify-content: center;
  padding: 16px 0 8px;
}

.overview {
  margin: 4px 16px 0;
  padding: 20px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
  color: var(--c-text);
}
.overview.is-warning,
.overview.is-reached {
  border-color: transparent;
  background: var(--c-warning-light);
  color: #8a5a00;
}
.overview.is-exceeded {
  border-color: transparent;
  background: var(--c-expense-light);
  color: var(--c-expense);
}
.overview__label {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--c-text-3);
}
.overview.is-warning .overview__label,
.overview.is-reached .overview__label {
  color: #a06a00;
}
.overview.is-exceeded .overview__label {
  color: var(--c-expense);
}
.overview__value {
  margin: 0 0 14px;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}
.overview__bar {
  margin-bottom: 8px;
}
.overview__nums {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--c-text-3);
}
.overview.is-warning .overview__nums,
.overview.is-reached .overview__nums {
  color: #a06a00;
}
.overview.is-exceeded .overview__nums {
  color: var(--c-expense);
}
.overview__hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.setter {
  margin: 12px 16px 0;
}
.setter__title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.setter__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.setter__chip {
  font-size: 13px;
}
.setter__error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--c-expense);
}
.setter__btn {
  margin-top: 14px;
}

.foot {
  margin: 20px 28px 0;
  text-align: center;
  font-size: 11px;
  line-height: 1.7;
  color: var(--c-text-3);
}
</style>
