<template>
  <div class="mine">
    <!-- 用户信息 -->
    <header class="profile">
      <div class="profile__avatar">{{ avatarText }}</div>
      <div class="profile__info">
        <p class="profile__name">{{ userStore.nickname }}</p>
        <p class="profile__email">{{ accountLine }}</p>
      </div>
      <button class="profile__edit" type="button" aria-label="修改昵称" @click="openNickname">
        <van-icon name="edit" size="18" />
      </button>
    </header>

    <!-- 本月小结，给用户一点正反馈 -->
    <div class="mini">
      <div class="mini__item">
        <span>本月收入</span>
        <b class="num text-income">¥{{ money(overview.income || 0) }}</b>
      </div>
      <div class="mini__item">
        <span>本月支出</span>
        <b class="num text-expense">¥{{ money(overview.expense || 0) }}</b>
      </div>
      <div class="mini__item">
        <span>累计记账</span>
        <b class="num">{{ overview.recordCount || 0 }} 笔</b>
      </div>
    </div>

    <!-- 功能入口 -->
    <div class="group">
      <van-cell title="账单明细" icon="orders-o" is-link to="/records" />
      <van-cell title="统计报表" icon="bar-chart-o" is-link to="/stats" />
      <van-cell title="分类管理" icon="label-o" is-link to="/categories" />
      <van-cell title="月度预算" icon="gold-coin-o" is-link to="/budget" />
    </div>

    <div class="group">
      <van-cell title="邮箱" icon="envelop-o" :value="userStore.profile?.email || '未绑定'" />
      <van-cell title="修改密码" icon="lock" is-link @click="openPassword" />
      <van-cell
        v-if="userStore.isAdmin"
        title="管理后台"
        icon="setting-o"
        is-link
        value="管理员"
        @click="$router.push('/admin')"
      />
      <van-cell title="关于轻记" icon="info-o" is-link @click="showAbout = true" />
    </div>

    <div class="logout">
      <van-button block round plain type="danger" @click="onLogout">退出登录</van-button>
    </div>

    <p class="version">轻记 v1.0 · 数据仅属于你自己</p>

    <!-- 修改昵称 -->
    <van-dialog v-model:show="showNickname" title="修改昵称" show-cancel-button @confirm="saveNickname">
      <van-field v-model="nicknameDraft" placeholder="请输入新昵称" maxlength="20" />
    </van-dialog>

    <!-- 修改密码 -->
    <van-dialog
      v-model:show="showPassword"
      title="修改密码"
      show-cancel-button
      :before-close="beforePasswordClose"
    >
      <van-field
        v-model="pwd.oldPassword"
        type="password"
        label="原密码"
        placeholder="请输入原密码"
      />
      <van-field v-model="pwd.newPassword" type="password" label="新密码" placeholder="至少 6 位" />
      <van-field
        v-model="pwd.confirm"
        type="password"
        label="确认"
        placeholder="再输一次新密码"
      />
    </van-dialog>

    <!-- 关于 -->
    <van-popup v-model:show="showAbout" position="bottom" round>
      <div class="about">
        <div class="about__logo"><BrandMark :size="52" /></div>
        <h3>轻记 · 个人记账</h3>
        <p>
          一个为移动端设计的记账工具：随手记一笔，自动汇总当月收支、分类占比和预算进度，
          让每一笔花销都有据可查。
        </p>
        <p class="about__meta">版本 1.0.0 · 数据存储于本地服务</p>
        <van-button block round type="primary" @click="showAbout = false">知道了</van-button>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { statsApi } from '@/api'
import { useUserStore } from '@/store/user'
import { money } from '@/utils/format'
import BrandMark from '@/components/BrandMark.vue'

const userStore = useUserStore()
const router = useRouter()

const overview = ref({})
const showNickname = ref(false)
const showPassword = ref(false)
const showAbout = ref(false)
const nicknameDraft = ref('')
const pwd = reactive({ oldPassword: '', newPassword: '', confirm: '' })

const avatarText = computed(() => (userStore.nickname || '记').slice(0, 1).toUpperCase())
const accountLine = computed(
  () => userStore.profile?.email || `@${userStore.profile?.username || ''}`,
)

function openNickname() {
  nicknameDraft.value = userStore.nickname
  showNickname.value = true
}

async function saveNickname() {
  const value = nicknameDraft.value.trim()
  if (!value) {
    showToast('昵称不能为空')
    return false
  }
  try {
    await userStore.updateProfile(value)
    showToast({ type: 'success', message: '已更新' })
  } catch (err) {
    showToast(err.message || '更新失败')
  }
}

function openPassword() {
  pwd.oldPassword = ''
  pwd.newPassword = ''
  pwd.confirm = ''
  showPassword.value = true
}

/** 在弹窗关闭前做校验，校验不通过就阻止关闭 */
async function beforePasswordClose(action) {
  if (action !== 'confirm') return true
  if (!pwd.oldPassword) return showToastAndStay('请输入原密码')
  if (!pwd.newPassword || pwd.newPassword.length < 6) return showToastAndStay('新密码至少 6 位')
  if (pwd.newPassword !== pwd.confirm) return showToastAndStay('两次输入的新密码不一致')

  try {
    await userStore.changePassword({
      oldPassword: pwd.oldPassword,
      newPassword: pwd.newPassword,
    })
    showToast({ type: 'success', message: '密码已修改，请重新登录' })
    router.replace('/login')
    return true
  } catch (err) {
    return showToastAndStay(err.message || '修改失败')
  }
}

function showToastAndStay(message) {
  showToast(message)
  return false
}

async function onLogout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定要退出当前账号吗？' })
  } catch {
    return
  }
  await userStore.logout()
  router.replace('/login')
}

onMounted(async () => {
  try {
    overview.value = await statsApi.overview()
  } catch {
    // 概览加载失败不影响使用，静默处理
  }
})
</script>

<style scoped>
.mine {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(24px + var(--safe-bottom));
  background: var(--c-bg);
}

/* ---------- 头部 ---------- */
.profile {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: calc(24px + var(--safe-top)) 20px 32px;
  background: var(--c-card);
  border-radius: 0 0 var(--r-xl) var(--r-xl);
  box-shadow: var(--shadow-sm);
}
.profile__avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
  font-size: 24px;
  font-weight: 700;
}
.profile__info {
  flex: 1;
  min-width: 0;
}
.profile__name {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  color: var(--c-text);
}
.profile__email {
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile__edit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--c-bg);
  color: var(--c-text-2);
}
.profile__edit:active {
  background: var(--c-primary-light);
  color: var(--c-primary-dark);
}

/* ---------- 小结 ---------- */
.mini {
  position: relative;
  z-index: 1;
  display: flex;
  margin: -14px 16px 0;
  padding: 15px 8px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.mini__item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}
.mini__item + .mini__item {
  border-left: 1px solid var(--c-line);
}
.mini__item span {
  font-size: 11px;
  color: var(--c-text-3);
}
.mini__item b {
  font-size: 15px;
  font-weight: 600;
}

/* ---------- 单元格组 ---------- */
.group {
  margin: 12px 16px;
  overflow: hidden;
  border-radius: var(--r-lg);
  background: var(--c-card);
  box-shadow: var(--shadow-sm);
}
.group :deep(.van-cell) {
  padding: 14px 16px;
  background: transparent;
}
.group :deep(.van-cell__left-icon) {
  color: var(--c-primary-dark);
  margin-right: 12px;
}
.group :deep(.van-cell::after) {
  border-color: var(--c-line);
}

.logout {
  margin: 20px 16px 0;
}
.version {
  margin: 18px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--c-text-3);
}

/* ---------- 关于 ---------- */
.about {
  padding: 26px 22px calc(28px + var(--safe-bottom));
  text-align: center;
}
.about__logo {
  display: flex;
  justify-content: center;
  margin-bottom: 4px;
}
.about h3 {
  margin: 8px 0 12px;
  font-size: 17px;
}
.about p {
  margin: 0 0 10px;
  text-align: left;
  font-size: 13px;
  line-height: 1.75;
  color: var(--c-text-2);
}
.about__meta {
  margin-bottom: 18px !important;
  text-align: center !important;
  font-size: 11px !important;
  color: var(--c-text-3) !important;
}
</style>
