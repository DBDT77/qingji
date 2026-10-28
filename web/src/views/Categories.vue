<template>
  <div class="cats-page">
    <van-nav-bar title="分类管理" left-arrow fixed placeholder safe-area-inset-top @click-left="$router.back()" />

    <van-tabs
      v-model:active="activeTab"
      sticky
      offset-top="46"
      line-width="24"
    >
      <van-tab title="支出" name="expense" />
      <van-tab title="收入" name="income" />
    </van-tabs>

    <div class="tip">
      分类会影响统计口径。已被记录使用的分类不能直接删除，需要先把相关记录改到别的分类。
    </div>

    <div class="cats">
      <div v-for="c in list" :key="c.id" class="cat">
        <CatIcon :icon="c.icon" :color="c.color" :size="44" />
        <div class="cat__main">
          <span class="cat__name">{{ c.name }}</span>
          <span class="cat__meta">{{ c.isDefault ? '系统默认' : '自定义' }}</span>
        </div>
        <button class="cat__action" type="button" aria-label="编辑" @click="openEdit(c)">
          <van-icon name="edit" size="18" />
        </button>
        <button
          class="cat__action cat__action--danger"
          type="button"
          aria-label="删除"
          @click="remove(c)"
        >
          <van-icon name="delete-o" size="18" />
        </button>
      </div>
      <EmptyState v-if="!list.length" emoji="🏷️" text="还没有分类，先添加一个" />
    </div>

    <button class="add" type="button" @click="openCreate">
      <van-icon name="plus" size="18" />
      新增{{ activeTab === 'expense' ? '支出' : '收入' }}分类
    </button>

    <!-- 新增 / 编辑弹层 -->
    <van-popup
      v-model:show="showEditor"
      position="bottom"
      round
      :style="{ paddingBottom: 'calc(24px + var(--safe-bottom))' }"
    >
      <div class="editor">
        <p class="editor__title">{{ editing ? '编辑分类' : '新增分类' }}</p>

        <van-field v-model="draft.name" label="名称" maxlength="10" placeholder="例如：宠物" clearable />

        <div class="editor__block">
          <span class="editor__block-label">图标</span>
          <div class="editor__icons">
            <button
              v-for="icon in icons"
              :key="icon"
              type="button"
              class="editor__icon"
              :class="{ 'is-active': draft.icon === icon }"
              @click="draft.icon = icon"
            >
              {{ icon }}
            </button>
          </div>
        </div>

        <div class="editor__block">
          <span class="editor__block-label">颜色</span>
          <div class="editor__colors">
            <button
              v-for="color in colors"
              :key="color"
              type="button"
              class="editor__color"
              :style="{ background: color, color }"
              :class="{ 'is-active': draft.color === color }"
              :aria-label="`颜色 ${color}`"
              @click="draft.color = color"
            />
          </div>
        </div>

        <div class="editor__actions">
          <van-button block round type="primary" :loading="saving" @click="save">
            {{ editing ? '保存修改' : '添加' }}
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { categoryApi } from '@/api'
import CatIcon from '@/components/CatIcon.vue'
import EmptyState from '@/components/EmptyState.vue'

const activeTab = ref('expense')
const all = ref([])
const showEditor = ref(false)
const editing = ref(null)
const saving = ref(false)

const draft = reactive({ name: '', icon: '🏷️', color: '#12B886' })

const icons = [
  '🍜', '🍱', '☕', '🛒', '🚌', '🚗', '🏠', '💡',
  '🎮', '🎬', '🏃', '💊', '📚', '🎁', '🐱', '💼',
  '💰', '📈', '🎓', '✈️', '🏷️', '❓',
]
const colors = [
  '#4C6EF5', '#12B779', '#FA5252', '#F59F00', '#22B8CF',
  '#F06595', '#7950F2', '#20C997', '#FD7E14', '#868E96',
]

const list = computed(() => all.value.filter((c) => c.type === activeTab.value))

async function load() {
  all.value = await categoryApi.list()
}

function openCreate() {
  editing.value = null
  draft.name = ''
  draft.icon = activeTab.value === 'expense' ? '🍜' : '💰'
  draft.color = '#12B886'
  showEditor.value = true
}

function openEdit(cat) {
  editing.value = cat
  draft.name = cat.name
  draft.icon = cat.icon
  draft.color = cat.color
  showEditor.value = true
}

async function save() {
  if (!draft.name.trim()) {
    showToast('请输入分类名称')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await categoryApi.update(editing.value.id, {
        name: draft.name.trim(),
        icon: draft.icon,
        color: draft.color,
      })
      showToast({ type: 'success', message: '已保存' })
    } else {
      await categoryApi.create({
        name: draft.name.trim(),
        type: activeTab.value,
        icon: draft.icon,
        color: draft.color,
      })
      showToast({ type: 'success', message: '已添加' })
    }
    showEditor.value = false
    await load()
  } catch (err) {
    showToast(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(cat) {
  try {
    await showConfirmDialog({
      title: '删除分类',
      message: `确定删除「${cat.name}」吗？`,
      confirmButtonText: '删除',
      confirmButtonColor: '#F0435B',
    })
  } catch {
    return
  }
  try {
    await categoryApi.remove(cat.id)
    showToast({ type: 'success', message: '已删除' })
    await load()
  } catch (err) {
    // 分类被记录引用时后端会拒绝，这里把原因直接透给用户
    showToast(err.message || '删除失败')
  }
}

watch(activeTab, () => {
  editing.value = null
})

onMounted(load)
</script>

<style scoped>
.cats-page {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(92px + var(--safe-bottom));
  background: var(--c-bg);
}
.tip {
  margin: 12px 16px 4px;
  padding: 11px 14px;
  border-radius: var(--r-md);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
}
.cats {
  margin: 8px 16px;
  padding: 4px 14px;
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.cat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
}
.cat + .cat {
  border-top: 1px solid var(--c-line);
}
.cat__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.cat__name {
  font-size: 14px;
  font-weight: 500;
}
.cat__meta {
  width: fit-content;
  padding: 1px 7px;
  border-radius: var(--r-pill);
  background: var(--c-bg);
  color: var(--c-text-3);
  font-size: 10px;
}
.cat__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--c-text-3);
}
.cat__action:active {
  background: var(--c-bg);
}
.cat__action--danger {
  color: var(--c-expense);
}

.add {
  position: fixed;
  left: 50%;
  bottom: calc(16px + var(--safe-bottom));
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: min(calc(100% - 32px), calc(var(--app-max) - 32px));
  padding: 14px;
  border: none;
  border-radius: var(--r-pill);
  background: var(--c-primary);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  box-shadow: var(--shadow-fab);
  transform: translateX(-50%);
}
.add:active {
  transform: translateX(-50%) scale(0.98);
}

/* ---------- 编辑器 ---------- */
.editor {
  padding: 20px 16px 0;
}
.editor__title {
  margin: 0 0 12px;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
}
.editor__block {
  margin-top: 16px;
}
.editor__block-label {
  font-size: 13px;
  color: var(--c-text-2);
}
.editor__icons {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
  margin-top: 10px;
}
.editor__icon {
  display: flex;
  aspect-ratio: 1;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--c-line);
  border-radius: var(--r-sm);
  background: var(--c-card);
  font-size: 18px;
}
.editor__icon.is-active {
  border-color: var(--c-primary);
  background: var(--c-primary-light);
}
.editor__colors {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.editor__color {
  width: 28px;
  height: 28px;
  border: 2px solid transparent;
  border-radius: 50%;
}
.editor__color.is-active {
  border-color: var(--c-card);
  box-shadow: 0 0 0 2px currentColor;
}
.editor__actions {
  margin-top: 24px;
}
</style>
