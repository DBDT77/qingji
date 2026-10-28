<template>
  <van-popup
    v-model:show="visible"
    position="bottom"
    round
    :style="{ maxHeight: '92vh' }"
  >
    <div class="ai-sheet">
      <header class="ai-head">
        <div class="ai-title">
          <span class="ai-badge">AI</span>
          <h3>智能记账</h3>
          <span class="ai-mode">{{ modeLabel }}</span>
        </div>
        <button class="ai-close" type="button" aria-label="关闭" @click="close">
          <van-icon name="cross" size="18" />
        </button>
      </header>

      <div class="ai-tabs">
        <button
          v-for="t in tabs"
          :key="t.value"
          type="button"
          :class="{ 'is-active': tab === t.value }"
          @click="tab = t.value"
        >
          {{ t.label }}
        </button>
      </div>

      <p v-if="modeNote" class="ai-mode-note">{{ modeNote }}</p>

      <div class="ai-body">
        <!-- 文字记账 -->
        <template v-if="tab === 'text'">
          <textarea
            v-model="text"
            class="ai-input"
            rows="3"
            maxlength="2000"
            placeholder="比如：昨天午饭 35，打车 22"
          />
          <div class="ai-examples">
            <button
              v-for="ex in examples"
              :key="ex"
              class="chip"
              type="button"
              @click="text = ex"
            >
              {{ ex }}
            </button>
          </div>
          <van-button
            block
            round
            type="primary"
            :loading="parsing"
            class="ai-primary"
            @click="parse"
          >
            解析成记账草稿
          </van-button>
        </template>

        <!-- 拍照识别 -->
        <template v-else-if="tab === 'photo'">
          <div v-if="!photo" class="ai-upload" @click="pickPhoto">
            <van-icon name="photograph" size="28" />
            <b>拍照或选择小票</b>
            <span>本地 OCR 识别金额、日期和商户；文字模糊时请核对</span>
          </div>
          <div v-else class="ai-photo">
            <img :src="photo" alt="小票预览" />
            <button class="ai-photo__change" type="button" @click="pickPhoto">重新选择</button>
          </div>
          <input
            ref="fileRef"
            class="ai-file"
            type="file"
            accept="image/*"
            capture="environment"
            @change="onFileChange"
          />
          <van-button
            block
            round
            type="primary"
            :loading="recognizing"
            :disabled="!photo"
            class="ai-primary"
            @click="recognize"
          >
            识别小票
          </van-button>
        </template>

        <!-- 问一问 -->
        <template v-else>
          <div ref="chatScroll" class="chat">
            <div
              v-for="m in messages"
              :key="m.key"
              class="chat__row"
              :class="`is-${m.role}`"
            >
              <div class="chat__bubble">{{ m.text }}</div>
            </div>
            <div v-if="chatting" class="chat__row is-assistant">
              <div class="chat__bubble">正在计算…</div>
            </div>
          </div>
          <div class="chat__quick">
            <button
              v-for="s in chatSuggestions"
              :key="s"
              class="chip"
              type="button"
              @click="sendChat(s)"
            >
              {{ s }}
            </button>
          </div>
          <div class="chat__input">
            <van-field
              v-model="chatInput"
              placeholder="问本月花了多少…"
              :border="false"
              @keyup.enter="sendChat()"
            >
              <template #button>
                <van-button size="small" round type="primary" :loading="chatting" @click="sendChat()">
                  发送
                </van-button>
              </template>
            </van-field>
          </div>
        </template>

        <div v-if="notice" class="ai-notice">{{ notice }}</div>
        <div v-if="errors.length" class="ai-errors">
          <p v-for="e in errors" :key="`${e.text}-${e.reason}`">
            未识别：{{ e.text }}（{{ e.reason }}）
          </p>
        </div>

        <!-- 可编辑草稿 -->
        <div v-if="tab !== 'chat' && drafts.length" class="ai-drafts">
          <div class="ai-drafts__head">
            <span>解析结果</span>
            <span class="muted">可以直接修改后保存</span>
          </div>

          <div
            v-for="(d, i) in drafts"
            :key="d.key"
            class="draft"
            :class="{ 'is-income': d.type === 'income' }"
          >
            <div class="draft__top">
              <div class="draft__seg">
                <button
                  type="button"
                  class="draft__type draft__type--expense"
                  :class="{ 'is-active': d.type === 'expense' }"
                  @click="switchType(d, 'expense')"
                >
                  支出
                </button>
                <button
                  type="button"
                  class="draft__type draft__type--income"
                  :class="{ 'is-active': d.type === 'income' }"
                  @click="switchType(d, 'income')"
                >
                  收入
                </button>
              </div>
              <div class="draft__right">
                <span v-if="d.confidence === 'low'" class="draft__tag">请核对</span>
                <button class="draft__remove" type="button" aria-label="删除这笔草稿" @click="removeDraft(i)">
                  <van-icon name="cross" size="14" />
                </button>
              </div>
            </div>

            <div class="draft__amount">
              <span>¥</span>
              <input
                :value="d.amount"
                inputmode="decimal"
                aria-label="金额"
                @input="onAmountInput(d, $event)"
              />
            </div>

            <div class="draft__cats">
              <button
                v-for="c in catsOf(d)"
                :key="c.id"
                type="button"
                class="draft__cat"
                :class="{ 'is-active': d.categoryId === c.id }"
                @click="d.categoryId = c.id"
              >
                {{ c.icon }} {{ c.name }}
              </button>
            </div>

            <div class="draft__meta">
              <input v-model="d.date" type="date" class="draft__date" aria-label="日期" />
              <input v-model="d.note" class="draft__note" maxlength="100" placeholder="备注" />
            </div>
            <p v-if="d.raw" class="draft__raw">原文：{{ d.raw }}</p>
          </div>
        </div>
      </div>

      <footer v-if="tab !== 'chat' && drafts.length" class="ai-foot">
        <van-button block round type="primary" :loading="saving" @click="saveAll">
          确认保存 {{ drafts.length }} 笔
        </van-button>
      </footer>
    </div>
  </van-popup>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { showToast } from 'vant'
import { aiApi, categoryApi, recordApi } from '@/api'

const props = defineProps({
  show: { type: Boolean, default: false },
})
const emit = defineEmits(['update:show', 'saved'])

const visible = computed({
  get: () => props.show,
  set: (v) => emit('update:show', v),
})

const tabs = [
  { value: 'text', label: '文字记账' },
  { value: 'photo', label: '拍照识别' },
  { value: 'chat', label: '问一问' },
]

const examples = ['昨天午饭 35，打车 22', '工资 8000', '10月5日超市 128']

const tab = ref('text')
const aiStatus = ref(null)
const categories = ref([])
const text = ref('')
const parsing = ref(false)
const drafts = ref([])
const errors = ref([])
const notice = ref('')
const saving = ref(false)
const photo = ref('')
const recognizing = ref(false)
const fileRef = ref(null)
const chatScroll = ref(null)
const chatInput = ref('')
const chatting = ref(false)
const chatSuggestions = ref(['本月花了多少', '哪类花得最多', '预算还剩多少', '和上月对比'])
const messages = ref([])
let seq = 0

const modeLabel = computed(() => {
  const s = aiStatus.value
  if (!s) return 'AI'
  if (s.mode === 'cloud') return s.model ? `云端 · ${s.model}` : '云端 AI'
  return '本地规则'
})
const modeNote = computed(() => aiStatus.value?.notice || '')

watch(
  () => props.show,
  async (show) => {
    if (!show) return
    const [cats, status] = await Promise.all([
      categories.value.length ? Promise.resolve(null) : categoryApi.list().catch(() => []),
      aiApi.status().catch(() => null),
    ])
    if (cats) categories.value = cats
    if (status) {
      aiStatus.value = status
      if (Array.isArray(status.suggestions) && status.suggestions.length) {
        chatSuggestions.value = status.suggestions
      }
    }
    text.value = ''
    drafts.value = []
    errors.value = []
    notice.value = ''
    photo.value = ''
    tab.value = 'text'
    if (!messages.value.length) {
      messages.value = [
        {
          key: ++seq,
          role: 'assistant',
          text: '你好，我是轻记的 AI 助手。可以问我月度收支，也可以直接说「昨天午饭 35」让我帮你记账。',
        },
      ]
    }
  },
)

watch(tab, (value) => {
  if (value === 'chat') scrollChat()
})

function close() {
  visible.value = false
}

function addDrafts(list) {
  drafts.value = (list || []).map((d) => ({ ...d, key: ++seq }))
}

async function parse() {
  const value = text.value.trim()
  if (!value) {
    showToast('先输入一句话，比如「昨天午饭 35」')
    return
  }
  parsing.value = true
  errors.value = []
  notice.value = ''
  try {
    const res = await aiApi.parse(value)
    addDrafts(res.drafts)
    errors.value = res.errors || []
    notice.value = res.notice || ''
    if (!res.drafts?.length) showToast('没有解析出可保存的记录，看看下方提示')
  } catch {
    // http 拦截器已弹错误提示
  } finally {
    parsing.value = false
  }
}

function catsOf(draft) {
  return categories.value.filter((c) => c.type === draft.type)
}

function switchType(draft, type) {
  draft.type = type
  if (!catsOf(draft).some((c) => c.id === draft.categoryId)) {
    draft.categoryId = catsOf(draft)[0]?.id ?? null
  }
}

function onAmountInput(draft, e) {
  let value = String(e.target.value || '').replace(/[^\d.]/g, '')
  const parts = value.split('.')
  if (parts.length > 2) value = `${parts[0]}.${parts.slice(1).join('')}`
  if (value.includes('.')) {
    const [intPart, dec = ''] = value.split('.')
    value = `${intPart.slice(0, 8)}.${dec.slice(0, 2)}`
  } else {
    value = value.slice(0, 8)
  }
  draft.amount = value
  e.target.value = value
}

function removeDraft(index) {
  drafts.value.splice(index, 1)
}

function validateDrafts() {
  for (let i = 0; i < drafts.value.length; i += 1) {
    const d = drafts.value[i]
    if (!/^\d+(\.\d{1,2})?$/.test(d.amount) || !(Number(d.amount) > 0)) {
      showToast(`第 ${i + 1} 笔金额不正确`)
      return false
    }
    if (!d.categoryId) {
      showToast(`第 ${i + 1} 笔还没选分类`)
      return false
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      showToast(`第 ${i + 1} 笔日期不正确`)
      return false
    }
  }
  return true
}

async function saveAll() {
  if (!drafts.value.length || !validateDrafts()) return
  saving.value = true
  const remaining = []
  let saved = 0
  for (const d of drafts.value) {
    try {
      await recordApi.create({
        type: d.type,
        amount: d.amount,
        categoryId: d.categoryId,
        date: d.date,
        note: d.note,
      })
      saved += 1
    } catch (err) {
      remaining.push(d)
      showToast(err.message || '有一笔保存失败')
    }
  }
  drafts.value = remaining
  saving.value = false

  if (saved) {
    showToast({ type: 'success', message: `已保存 ${saved} 笔` })
    emit('saved')
  }
  if (!remaining.length) visible.value = false
}

function pickPhoto() {
  fileRef.value?.click()
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function compressImage(dataUrl, maxSide, quality) {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

async function onFileChange(e) {
  const file = e.target?.files?.[0]
  if (e.target) e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件')
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast('图片不能超过 8MB')
    return
  }
  try {
    const raw = await readFile(file)
    let compressed = await compressImage(raw, 1000, 0.72)
    if (compressed.length > 700_000) {
      compressed = await compressImage(raw, 760, 0.6)
    }
    if (compressed.length > 700_000) {
      showToast('图片压缩后仍然太大，请换一张')
      return
    }
    photo.value = compressed
    drafts.value = []
    errors.value = []
    notice.value = ''
  } catch {
    showToast('图片读取失败，请换一张')
  }
}

async function recognize() {
  if (!photo.value) {
    showToast('请先选择小票图片')
    return
  }
  recognizing.value = true
  errors.value = []
  notice.value = ''
  try {
    const res = await aiApi.receipt(photo.value)
    addDrafts(res.drafts)
    errors.value = res.errors || []
    notice.value = res.notice || ''
  } catch {
    // http 拦截器已弹错误提示
  } finally {
    recognizing.value = false
  }
}

async function scrollChat() {
  await nextTick()
  if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight
}

async function sendChat(prefill) {
  const value = String(prefill ?? chatInput.value).trim()
  if (!value || chatting.value) return
  messages.value.push({ key: ++seq, role: 'user', text: value })
  chatInput.value = ''
  chatting.value = true
  scrollChat()
  try {
    const res = await aiApi.chat(value)
    messages.value.push({ key: ++seq, role: 'assistant', text: res.reply })
    if (Array.isArray(res.suggestions) && res.suggestions.length) {
      chatSuggestions.value = res.suggestions
    }
    if (res.notice) notice.value = res.notice
  } catch {
    messages.value.push({
      key: ++seq,
      role: 'assistant',
      text: '刚才没答上来，再试一次吧。',
    })
  } finally {
    chatting.value = false
    scrollChat()
  }
}
</script>

<style scoped>
.ai-sheet {
  display: flex;
  max-height: 92vh;
  flex-direction: column;
  background: var(--c-card);
}
.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 8px;
}
.ai-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-badge {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--c-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.ai-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.ai-mode {
  padding: 2px 7px;
  border-radius: var(--r-pill);
  background: var(--c-bg);
  color: var(--c-text-3);
  font-size: 10px;
}
.ai-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--c-text-3);
}
.ai-close:active {
  background: var(--c-bg);
}

.ai-tabs {
  display: flex;
  gap: 6px;
  padding: 4px 16px 10px;
}
.ai-tabs button {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: var(--r-pill);
  background: var(--c-bg);
  color: var(--c-text-2);
  font-size: 12px;
}
.ai-tabs button.is-active {
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-weight: 600;
}

.ai-mode-note {
  margin: 0 16px 10px;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--c-bg);
  color: var(--c-text-3);
  font-size: 10px;
  line-height: 1.55;
}

.ai-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
  -webkit-overflow-scrolling: touch;
}

.ai-input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  outline: none;
  background: var(--c-bg);
  color: var(--c-text);
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}
.ai-input::placeholder {
  color: var(--c-text-3);
}
.ai-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 12px;
}
.ai-examples .chip {
  font-size: 11px;
}
.ai-primary {
  margin-top: 4px;
}

.ai-upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 12px;
  border: 1px dashed var(--c-line);
  border-radius: var(--r-lg);
  background: var(--c-bg);
  color: var(--c-text-3);
  font-size: 12px;
  text-align: center;
}
.ai-upload b {
  color: var(--c-text);
  font-size: 14px;
}
.ai-photo {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-md);
}
.ai-photo img {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
}
.ai-photo__change {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 5px 10px;
  border: none;
  border-radius: var(--r-pill);
  background: rgba(28, 31, 34, 0.65);
  color: #fff;
  font-size: 11px;
}
.ai-file {
  display: none;
}

.ai-notice {
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-size: 11px;
  line-height: 1.6;
}
.ai-errors {
  margin-top: 10px;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--c-expense-light);
  color: var(--c-expense);
  font-size: 11px;
  line-height: 1.6;
}
.ai-errors p {
  margin: 2px 0;
}

.ai-drafts {
  margin-top: 14px;
}
.ai-drafts__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}
.ai-drafts__head .muted {
  font-size: 11px;
  font-weight: 400;
}

.draft {
  margin-bottom: 10px;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  background: var(--c-card);
}
.draft__top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.draft__seg {
  display: flex;
  padding: 3px;
  border-radius: var(--r-pill);
  background: var(--c-bg);
}
.draft__type {
  padding: 5px 14px;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--c-text-3);
  font-size: 12px;
}
.draft__type--expense.is-active {
  background: var(--c-expense-light);
  color: var(--c-expense);
  font-weight: 600;
}
.draft__type--income.is-active {
  background: var(--c-income-light);
  color: var(--c-income);
  font-weight: 600;
}
.draft__right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.draft__tag {
  padding: 2px 7px;
  border-radius: var(--r-pill);
  background: var(--c-warning-light);
  color: var(--c-warning);
  font-size: 10px;
}
.draft__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--c-text-3);
}
.draft__remove:active {
  background: var(--c-bg);
}

.draft__amount {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 10px 0 8px;
  color: var(--c-expense);
  font-size: 28px;
  font-weight: 700;
}
.draft__amount span {
  color: var(--c-text-3);
  font-size: 16px;
}
.draft__amount input {
  width: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}
.draft.is-income .draft__amount {
  color: var(--c-income);
}

.draft__cats {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: none;
}
.draft__cats::-webkit-scrollbar {
  display: none;
}
.draft__cat {
  flex-shrink: 0;
  padding: 5px 10px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-pill);
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 11px;
}
.draft__cat.is-active {
  border-color: var(--c-primary);
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-weight: 600;
}

.draft__meta {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.draft__date {
  width: 124px;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  outline: none;
  background: var(--c-bg);
  color: var(--c-text-2);
  font-size: 12px;
}
.draft__note {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  outline: none;
  background: var(--c-bg);
  color: var(--c-text);
  font-size: 12px;
}
.draft__raw {
  margin: 8px 0 0;
  color: var(--c-text-3);
  font-size: 10px;
}

.ai-foot {
  padding: 10px 16px calc(12px + var(--safe-bottom));
  border-top: 1px solid var(--c-line);
  background: var(--c-card);
}

.chat {
  display: flex;
  max-height: 42vh;
  min-height: 200px;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 4px 0 10px;
}
.chat__row {
  display: flex;
}
.chat__row.is-user {
  justify-content: flex-end;
}
.chat__bubble {
  max-width: 82%;
  padding: 9px 12px;
  border-radius: 14px;
  background: var(--c-bg);
  color: var(--c-text);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.chat__row.is-user .chat__bubble {
  border-bottom-right-radius: 4px;
  background: var(--c-primary);
  color: #fff;
}
.chat__row.is-assistant .chat__bubble {
  border-bottom-left-radius: 4px;
}
.chat__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 4px 0 10px;
}
.chat__quick .chip {
  font-size: 11px;
}
.chat__input {
  padding: 2px 6px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  background: var(--c-bg);
}
.chat__input :deep(.van-field) {
  background: transparent;
}
</style>
