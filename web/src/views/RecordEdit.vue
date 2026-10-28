<template>
  <div class="edit">
    <van-nav-bar
      :title="isEdit ? '编辑记录' : '记一笔'"
      left-arrow
      fixed
      placeholder
      safe-area-inset-top
      @click-left="$router.back()"
    >
      <template #right>
        <button v-if="!isEdit" class="nav-ai" type="button" @click="showAi = true">AI</button>
      </template>
    </van-nav-bar>

    <van-form @submit="onSubmit">
      <!-- 收入 / 支出 分段切换 -->
      <div class="seg">
        <button
          v-for="t in ['expense', 'income']"
          :key="t"
          type="button"
          class="seg__btn"
          :class="[`seg__btn--${t}`, { 'is-active': form.type === t }]"
          @click="form.type = t"
        >
          {{ t === 'expense' ? '支出' : '收入' }}
        </button>
      </div>

      <!-- 金额 -->
      <div class="amount">
        <span class="amount__symbol" :class="typeClass">¥</span>
        <input
          ref="amountRef"
          v-model="form.amount"
          class="amount__input num"
          :class="typeClass"
          type="text"
          inputmode="decimal"
          placeholder="0.00"
          @input="onAmountInput"
        />
      </div>
      <p v-if="amountError" class="amount__error">{{ amountError }}</p>

      <!-- 分类 -->
      <div class="cats">
        <div
          v-for="c in categories"
          :key="c.id"
          class="cat"
          @click="form.categoryId = c.id"
        >
          <CatIcon
            :icon="c.icon"
            :color="c.color"
            :size="46"
            :class="{ 'is-active': Number(form.categoryId) === c.id }"
            :style="Number(form.categoryId) === c.id ? { boxShadow: `0 0 0 2px ${c.color}` } : {}"
          />
          <span class="cat__name" :class="{ 'is-active': Number(form.categoryId) === c.id }">
            {{ c.name }}
          </span>
        </div>
        <div class="cat" @click="$router.push('/categories')">
          <span class="cat__add"><van-icon name="plus" size="18" /></span>
          <span class="cat__name">管理</span>
        </div>
      </div>
      <p v-if="categoryError" class="cats__error">{{ categoryError }}</p>

      <!-- 明细表单 -->
      <div class="form">
        <div class="form__row" @click="showDate = true">
          <span class="form__label">日期</span>
          <span class="form__value">{{ friendlyDate(form.date) }}</span>
          <van-icon name="arrow" size="14" class="muted" />
        </div>
        <div class="form__row">
          <span class="form__label">备注</span>
          <input
            v-model="form.note"
            class="form__input"
            type="text"
            maxlength="100"
            placeholder="添加备注（选填）"
          />
        </div>
        <div class="form__quick">
          <button
            v-for="t in quickNotes[form.type]"
            :key="t"
            type="button"
            class="form__tag"
            @click="form.note = t"
          >
            {{ t }}
          </button>
        </div>
      </div>

      <div class="actions">
        <van-button block round type="primary" native-type="submit" :loading="saving">
          {{ isEdit ? '保存修改' : '保存' }}
        </van-button>
        <van-button
          v-if="isEdit"
          block
          round
          plain
          type="danger"
          class="form__delete"
          @click="onDelete"
        >
          删除这条记录
        </van-button>
      </div>
    </van-form>

    <van-popup v-model:show="showDate" position="bottom" round>
      <van-date-picker
        :model-value="form.date.split('-')"
        title="选择日期"
        :min-date="minDate"
        :max-date="maxDate"
        @cancel="showDate = false"
        @confirm="onDateConfirm"
      />
    </van-popup>

    <AiAssistant v-model:show="showAi" @saved="$router.back()" />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { categoryApi, recordApi } from '@/api'
import { friendlyDate, todayStr } from '@/utils/format'
import AiAssistant from '@/components/AiAssistant.vue'
import CatIcon from '@/components/CatIcon.vue'

const route = useRoute()
const router = useRouter()

const isEdit = computed(() => Boolean(route.params.id))
const recordId = computed(() => Number(route.params.id))

const form = reactive({
  type: 'expense',
  amount: '',
  categoryId: null,
  date: todayStr(),
  note: '',
})

const allCategories = ref([])
const showDate = ref(false)
const showAi = ref(false)
const saving = ref(false)
const amountError = ref('')
const categoryError = ref('')
const amountRef = ref(null)

const minDate = new Date(2000, 0, 1)
const maxDate = new Date(new Date().getFullYear() + 1, 11, 31)

const quickNotes = {
  expense: ['早餐', '午餐', '晚餐', '打车', '外卖', '超市'],
  income: ['工资', '奖金', '报销', '兼职'],
}

/** 当前类型下可选的分类 */
const categories = computed(() => allCategories.value.filter((c) => c.type === form.type))

const typeClass = computed(() => (form.type === 'income' ? 'is-income' : 'is-expense'))

watch(
  () => form.type,
  () => {
    categoryError.value = ''
    // 换类型后原分类若不适用，自动选中新类型下的第一个
    if (!categories.value.some((c) => c.id === Number(form.categoryId))) {
      form.categoryId = categories.value[0]?.id ?? null
    }
    form.amount = ''
  },
)

/** 只允许数字与一个小数点，且最多两位小数、最多 8 位整数 */
function onAmountInput(e) {
  let value = String(e.target.value || '').replace(/[^\d.]/g, '')
  const parts = value.split('.')
  if (parts.length > 2) value = `${parts[0]}.${parts.slice(1).join('')}`
  if (value.includes('.')) {
    const [intPart, dec = ''] = value.split('.')
    value = `${intPart.slice(0, 8)}.${dec.slice(0, 2)}`
  } else {
    value = value.slice(0, 8)
  }
  form.amount = value
  e.target.value = value
  amountError.value = ''
}

function onDateConfirm({ selectedValues }) {
  form.date = selectedValues.join('-')
  showDate.value = false
}

async function loadCategories() {
  allCategories.value = await categoryApi.list()
  if (!form.categoryId && categories.value.length) {
    form.categoryId = categories.value[0].id
  }
}

async function loadRecord() {
  const record = await recordApi.get(recordId.value)
  form.type = record.type
  // 金额从分转回元，去掉无意义的 .0 结尾
  form.amount = String(Math.round(record.amount) / 100)
  form.categoryId = record.categoryId
  form.date = record.date
  form.note = record.note || ''
}

async function onSubmit() {
  amountError.value = ''
  categoryError.value = ''

  if (!form.amount) {
    amountError.value = '请输入金额'
    return
  }
  if (!/^\d+(\.\d{1,2})?$/.test(form.amount) || Number(form.amount) <= 0) {
    amountError.value = '金额必须大于 0，最多两位小数'
    return
  }
  if (!form.categoryId) {
    categoryError.value = '请先选择一个分类'
    return
  }

  saving.value = true
  const payload = {
    type: form.type,
    amount: form.amount,
    categoryId: form.categoryId,
    date: form.date,
    note: form.note,
  }
  try {
    if (isEdit.value) await recordApi.update(recordId.value, payload)
    else await recordApi.create(payload)
    showToast({ type: 'success', message: isEdit.value ? '已保存' : '记好啦' })
    setTimeout(() => router.back(), 350)
  } catch (err) {
    showToast(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  try {
    await showConfirmDialog({
      title: '删除记录',
      message: '删除后无法恢复，确定要删除吗？',
      confirmButtonText: '删除',
      confirmButtonColor: '#F0435B',
    })
  } catch {
    return // 用户点了取消
  }
  try {
    await recordApi.remove(recordId.value)
    showToast({ type: 'success', message: '已删除' })
    setTimeout(() => router.back(), 350)
  } catch (err) {
    showToast(err.message || '删除失败')
  }
}

onMounted(async () => {
  try {
    if (isEdit.value) {
      await loadRecord()
    } else {
      // 从首页「记支出 / 记收入」进来时带上类型，省去手动切换
      const t = route.query.type
      if (t === 'expense' || t === 'income') form.type = t
    }
    await loadCategories()
    // 新建时自动聚焦金额，省一次点击（移动端也会直接弹数字键盘）
    if (!isEdit.value) nextTick(() => amountRef.value?.focus())
  } catch (err) {
    showToast(err.message || '加载失败')
  }
})
</script>

<style scoped>
.edit {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(24px + var(--safe-bottom));
  background: var(--c-bg);
}

.nav-ai {
  padding: 4px 10px;
  border: none;
  border-radius: var(--r-pill);
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-size: 12px;
  font-weight: 600;
}
.nav-ai:active {
  opacity: 0.75;
}

/* ---------- 收支切换 ---------- */
.seg {
  display: flex;
  margin: 12px 16px;
  padding: 4px;
  border-radius: var(--r-pill);
  background: var(--c-bg);
}
.seg__btn {
  flex: 1;
  padding: 9px 0;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--c-text-3);
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s;
}
.seg__btn.is-active {
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.seg__btn--expense.is-active {
  color: var(--c-expense);
}
.seg__btn--income.is-active {
  color: var(--c-income);
}

/* ---------- 金额 ---------- */
.amount {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  padding: 16px 24px 20px;
}
.amount__symbol {
  font-size: 24px;
  font-weight: 600;
  color: var(--c-expense);
}
.amount__symbol.is-income {
  color: var(--c-income);
}
.amount__input {
  width: 100%;
  max-width: 300px;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--c-expense);
  font-size: 48px;
  font-weight: 700;
  text-align: center;
}
.amount__input.is-income {
  color: var(--c-income);
}
.amount__input::placeholder {
  color: #c9ced6;
}
.amount__error,
.cats__error {
  margin: -10px 16px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--c-expense);
}
.cats__error {
  margin-top: 12px;
}

/* ---------- 分类网格 ---------- */
.cats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px 6px;
  margin: 0 16px;
  padding: 16px 10px;
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.cat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.cat:active {
  opacity: 0.7;
}
.cat__name {
  font-size: 11px;
  color: var(--c-text-3);
}
.cat__name.is-active {
  color: var(--c-text);
  font-weight: 600;
}
.cat__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border: 1px dashed var(--c-line);
  border-radius: 15px;
  color: var(--c-text-3);
}

/* ---------- 表单 ---------- */
.form {
  margin: 12px 16px 0;
  padding: 2px 16px 12px;
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.form__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid var(--c-line);
}
.form__label {
  flex-shrink: 0;
  width: 48px;
  font-size: 14px;
  color: var(--c-text-2);
}
.form__value {
  flex: 1;
  font-size: 14px;
  text-align: right;
}
.form__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  text-align: right;
}
.form__input::placeholder {
  color: var(--c-text-3);
}
.form__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 14px;
}
.form__tag {
  padding: 5px 12px;
  border: none;
  border-radius: var(--r-pill);
  background: var(--c-bg);
  color: var(--c-text-2);
  font-size: 12px;
}
.form__tag:active {
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
}

.actions {
  margin: 20px 16px 0;
}
.form__delete {
  margin-top: 12px;
  --van-button-plain-background: transparent;
}
</style>
