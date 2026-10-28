<template>
  <div class="users">
    <!-- 搜索与筛选 -->
    <div class="toolbar">
      <van-search
        v-model="keyword"
        placeholder="搜索用户名、昵称或邮箱"
        shape="round"
        background="transparent"
        @search="reload"
        @clear="reload"
      />
      <div class="toolbar__filters">
        <button
          v-for="f in statusFilters"
          :key="f.value"
          type="button"
          class="toolbar__chip"
          :class="{ 'is-active': status === f.value }"
          @click="status = f.value"
        >
          {{ f.label }}
        </button>
        <button class="toolbar__add" type="button" @click="openCreate">
          <van-icon name="plus" size="14" /> 新建用户
        </button>
      </div>
      <!-- 从后台图表点进来时带的筛选，显示成可清除的提示条 -->
      <div v-if="chartFilterLabel" class="toolbar__applied">
        <span>{{ chartFilterLabel }}</span>
        <button type="button" class="toolbar__applied-clear" @click="clearChartFilter">
          清除 <van-icon name="cross" size="11" />
        </button>
      </div>
    </div>

    <!-- 用户列表 -->
    <div class="list">
      <div v-for="u in items" :key="u.id" class="user">
        <div class="user__avatar" :class="{ 'is-admin': u.role === 'admin' }">
          {{ (u.nickname || 'U').slice(0, 1) }}
        </div>
        <div class="user__main">
          <div class="user__line">
            <span class="user__name">{{ u.nickname }}</span>
            <span v-if="u.role === 'admin'" class="tag tag--admin">管理员</span>
            <span v-if="u.status === 'disabled'" class="tag tag--disabled">已停用</span>
          </div>
          <span class="user__email">
            @{{ u.username }}<template v-if="u.email"> · {{ u.email }}</template>
          </span>
          <span class="user__meta">
            {{ u.recordCount }} 笔记录 · 支出 ¥{{ money(u.totalExpense || 0) }}
          </span>
        </div>
        <van-icon name="setting-o" size="18" class="user__action" @click="openEdit(u)" />
      </div>
      <EmptyState v-if="!items.length && !loading" emoji="👥" text="没有匹配的用户" />
      <div class="list__more">
        <span v-if="loading">加载中...</span>
        <span v-else-if="items.length >= total && total">— 共 {{ total }} 位用户 —</span>
      </div>

      <van-button v-if="items.length < total" block size="small" plain @click="loadMore">
        加载更多
      </van-button>
    </div>

    <!-- 新建用户 -->
    <van-popup v-model:show="showCreate" position="bottom" round>
      <div class="editor">
        <p class="editor__title">新建用户</p>
        <van-field v-model="createForm.username" label="用户名" placeholder="登录用户名（字母开头）" />
        <van-field v-model="createForm.email" label="邮箱" placeholder="登录邮箱 you@example.com" />
        <van-field v-model="createForm.nickname" label="昵称" placeholder="请输入昵称" maxlength="20" />
        <van-field v-model="createForm.password" label="密码" type="password" placeholder="至少 6 位" />
        <div class="editor__role">
          <span>角色</span>
          <van-radio-group v-model="createForm.role" direction="horizontal">
            <van-radio name="user">普通用户</van-radio>
            <van-radio name="admin">管理员</van-radio>
          </van-radio-group>
        </div>
        <van-button block round type="primary" :loading="saving" class="editor__btn" @click="create">
          创建
        </van-button>
      </div>
    </van-popup>

    <!-- 编辑用户 -->
    <van-popup v-model:show="showEdit" position="bottom" round>
      <div class="editor" v-if="editing">
        <p class="editor__title">{{ editing.nickname }}</p>
        <p class="editor__sub">
          @{{ editing.username }}<template v-if="editing.email"> · {{ editing.email }}</template>
        </p>

        <van-field v-model="editForm.email" label="邮箱" placeholder="登录邮箱" />
        <van-field v-model="editForm.nickname" label="昵称" maxlength="20" />
        <van-field
          v-model="editForm.password"
          label="重置密码"
          type="password"
          placeholder="留空则不修改"
        />

        <div class="editor__block">
          <span class="editor__label">角色</span>
          <van-radio-group v-model="editForm.role" direction="horizontal">
            <van-radio name="user">普通用户</van-radio>
            <van-radio name="admin">管理员</van-radio>
          </van-radio-group>
        </div>

        <div class="editor__block">
          <span class="editor__label">状态</span>
          <van-radio-group v-model="editForm.status" direction="horizontal">
            <van-radio name="active">正常</van-radio>
            <van-radio name="disabled">停用</van-radio>
          </van-radio-group>
        </div>

        <van-button block round type="primary" :loading="saving" class="editor__btn" @click="update">
          保存
        </van-button>
        <van-button block round plain type="danger" class="editor__btn" @click="remove(editing)">
          删除该用户
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { adminApi } from '@/api'
import { money, monthLabel } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'

const route = useRoute()
const router = useRouter()

const keyword = ref('')
const status = ref('')
// 来自后台图表的筛选项（注册月份 / 该月有记账 / 活跃档位）
const createdMonth = ref('')
const activeMonth = ref('')
const layer = ref('')
const items = ref([])
const total = ref(0)
const loading = ref(false)
let page = 1
const pageSize = 15

const showCreate = ref(false)
const showEdit = ref(false)
const editing = ref(null)
const saving = ref(false)

const createForm = reactive({ username: '', email: '', nickname: '', password: '', role: 'user' })
const editForm = reactive({
  email: '',
  nickname: '',
  password: '',
  role: 'user',
  status: 'active',
})

const statusFilters = [
  { label: '全部', value: '' },
  { label: '正常', value: 'active' },
  { label: '停用', value: 'disabled' },
]

const LAYER_LABELS = {
  never: '从未记账',
  low: '1-9 笔',
  mid: '10-49 笔',
  high: '50 笔以上',
}

/** 图表下钻筛选的可读文案；没有筛选时为空 */
const chartFilterLabel = computed(() => {
  if (createdMonth.value) return `${monthLabel(createdMonth.value)} 注册的用户`
  if (activeMonth.value) return `${monthLabel(activeMonth.value)} 有记账的用户`
  if (layer.value) return `活跃档位：${LAYER_LABELS[layer.value] || layer.value}`
  return ''
})

async function load(reset = true) {
  if (reset) {
    page = 1
    items.value = []
  }
  loading.value = true
  try {
    const params = { page, pageSize }
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    if (status.value) params.status = status.value
    if (createdMonth.value) params.createdMonth = createdMonth.value
    if (activeMonth.value) params.activeMonth = activeMonth.value
    if (layer.value) params.layer = layer.value
    const res = await adminApi.users(params)
    items.value = page === 1 ? res.items : [...items.value, ...res.items]
    total.value = res.total
    page += 1
  } catch (err) {
    showToast(err.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function reload() {
  load(true)
}

function loadMore() {
  load(false)
}

watch(status, reload)

/**
 * 读取 URL 上的图表下钻参数。
 * 必须在 watch(route.query) 里做：App.vue 的 router-view 以 route.path 为 key，
 * 从 /admin/users?createdMonth=A 跳到 ?createdMonth=B 路径没变、组件不重建，
 * 只靠 onMounted 读一次会漏掉后续的点图跳转。
 */
function syncFromQuery() {
  const q = route.query
  createdMonth.value = q.createdMonth ? String(q.createdMonth) : ''
  activeMonth.value = q.activeMonth ? String(q.activeMonth) : ''
  layer.value = q.layer ? String(q.layer) : ''
}

function clearChartFilter() {
  createdMonth.value = ''
  activeMonth.value = ''
  layer.value = ''
  const query = { ...route.query }
  for (const key of ['createdMonth', 'activeMonth', 'layer']) delete query[key]
  router.replace({ path: route.path, query })
}

function openCreate() {
  Object.assign(createForm, {
    username: '',
    email: '',
    nickname: '',
    password: '',
    role: 'user',
  })
  showCreate.value = true
}

async function create() {
  if (
    !createForm.username.trim() ||
    !createForm.email.trim() ||
    !createForm.nickname.trim() ||
    !createForm.password
  ) {
    showToast('请填写用户名、邮箱、昵称和密码')
    return
  }
  saving.value = true
  try {
    await adminApi.createUser({ ...createForm })
    showToast({ type: 'success', message: '用户已创建' })
    showCreate.value = false
    reload()
  } catch (err) {
    showToast(err.message || '创建失败')
  } finally {
    saving.value = false
  }
}

function openEdit(user) {
  editing.value = user
  Object.assign(editForm, {
    email: user.email || '',
    nickname: user.nickname,
    password: '',
    role: user.role,
    status: user.status,
  })
  showEdit.value = true
}

async function update() {
  saving.value = true
  try {
    const payload = {
      email: editForm.email.trim(),
      nickname: editForm.nickname,
      role: editForm.role,
      status: editForm.status,
    }
    if (editForm.password) payload.password = editForm.password
    await adminApi.updateUser(editing.value.id, payload)
    showToast({ type: 'success', message: '已保存' })
    showEdit.value = false
    reload()
  } catch (err) {
    showToast(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(user) {
  try {
    await showConfirmDialog({
      title: '删除用户',
      message: `将删除「${user.nickname}」及其全部账目数据，且不可恢复。确定吗？`,
      confirmButtonText: '删除',
      confirmButtonColor: '#F0435B',
    })
  } catch {
    return
  }
  try {
    await adminApi.removeUser(user.id)
    showToast({ type: 'success', message: '已删除' })
    showEdit.value = false
    reload()
  } catch (err) {
    showToast(err.message || '删除失败')
  }
}

/** 从 URL 读筛选 → 触发重新加载 */
function syncFromQueryAndReload() {
  syncFromQuery()
  reload()
}

watch(
  () => route.query,
  () => {
    // 用户在本页手动改搜索/状态时会写回 URL 吗？不会 —— 只有图表下钻会带 query，
    // 所以这里直接按 query 重新同步并加载即可。
    syncFromQueryAndReload()
  },
)

onMounted(syncFromQueryAndReload)
</script>

<style scoped>
.users {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---------- 工具栏 ---------- */
.toolbar {
  padding: 2px 0 12px;
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.toolbar :deep(.van-search) {
  padding: 8px 12px;
}
.toolbar :deep(.van-search__content) {
  background: var(--c-bg);
}
.toolbar__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
}
.toolbar__chip {
  padding: 6px 12px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-pill);
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 12px;
}
.toolbar__chip.is-active {
  border-color: var(--c-primary);
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-weight: 600;
}
/* 图表下钻带进来的筛选提示条 */
.toolbar__applied {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 10px 14px 0;
  padding: 7px 10px 7px 12px;
  border-radius: var(--r-md);
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-size: 12px;
}
.toolbar__applied-clear {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 9px;
  border: none;
  border-radius: var(--r-pill);
  background: rgba(18, 184, 134, 0.14);
  color: var(--c-primary-dark);
  font-size: 11px;
  font-weight: 600;
}
.toolbar__add {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  padding: 6px 12px;
  border: none;
  border-radius: var(--r-pill);
  background: var(--c-primary);
  color: #fff;
  font-size: 12px;
}

/* ---------- 用户列表 ---------- */
.list {
  padding: 4px 14px 14px;
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.user + .user {
  border-top: 1px solid var(--c-line);
}
.user__avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-size: 17px;
  font-weight: 700;
}
.user__avatar.is-admin {
  background: var(--c-warning-light);
  color: var(--c-warning);
}
.user__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.user__line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.user__name {
  font-size: 14px;
  font-weight: 600;
}
.user__email {
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user__meta {
  font-size: 11px;
  color: var(--c-text-3);
}
.user__action {
  padding: 8px;
  color: var(--c-text-3);
}

.tag {
  padding: 1px 7px;
  border-radius: var(--r-pill);
  font-size: 10px;
}
.tag--admin {
  background: var(--c-warning-light);
  color: var(--c-warning);
}
.tag--disabled {
  background: var(--c-expense-light);
  color: var(--c-expense);
}

.list__more {
  padding: 12px 0 8px;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}

/* ---------- 编辑弹层 ---------- */
.editor {
  padding: 20px 16px calc(24px + var(--safe-bottom));
}
.editor__title {
  margin: 0;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
}
.editor__sub {
  margin: 4px 0 14px;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}
.editor__role,
.editor__block {
  margin-top: 16px;
}
.editor__block span.editor__label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--c-text-2);
}
.editor__role {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  font-size: 13px;
  color: var(--c-text-2);
}
.editor__btn {
  margin-top: 18px;
}
</style>
