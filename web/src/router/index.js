import { createRouter, createWebHashHistory } from 'vue-router'
import { useUserStore } from '@/store/user'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/Register.vue'),
    meta: { public: true, title: '注册' },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/ForgotPassword.vue'),
    meta: { public: true, title: '重置密码' },
  },
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/home',
    name: 'home',
    component: () => import('@/views/Home.vue'),
    meta: { tab: 'home', title: '轻记' },
  },
  {
    path: '/records',
    name: 'records',
    component: () => import('@/views/Records.vue'),
    meta: { tab: 'records', title: '账单' },
  },
  {
    path: '/stats',
    name: 'stats',
    component: () => import('@/views/Stats.vue'),
    meta: { tab: 'stats', title: '统计' },
  },
  {
    path: '/mine',
    name: 'mine',
    component: () => import('@/views/Mine.vue'),
    meta: { tab: 'mine', title: '我的' },
  },
  {
    path: '/record/new',
    name: 'record-new',
    component: () => import('@/views/RecordEdit.vue'),
    meta: { title: '记一笔' },
  },
  {
    path: '/record/:id/edit',
    name: 'record-edit',
    component: () => import('@/views/RecordEdit.vue'),
    meta: { title: '编辑记录' },
  },
  {
    path: '/categories',
    name: 'categories',
    component: () => import('@/views/Categories.vue'),
    meta: { title: '分类管理' },
  },
  {
    path: '/budget',
    name: 'budget',
    component: () => import('@/views/Budget.vue'),
    meta: { title: '月度预算' },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/admin/AdminLayout.vue'),
    meta: { admin: true, title: '管理后台' },
    children: [
      { path: '', redirect: '/admin/dashboard' },
      {
        path: 'dashboard',
        name: 'admin-dashboard',
        component: () => import('@/views/admin/Dashboard.vue'),
        meta: { title: '数据总览' },
      },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('@/views/admin/Users.vue'),
        meta: { title: '用户管理' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFound.vue'),
    meta: { public: true, title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  const store = useUserStore()
  // 首次进入先确认登录态，避免刷新页面被误判为未登录
  if (!store.ready) await store.fetchProfile()

  document.title = to.meta.title ? `${to.meta.title} · 轻记` : '轻记 · 个人记账'

  if (to.meta.public) {
    // 已登录用户不必再看到登录/注册/重置密码页
    if (
      store.isLoggedIn &&
      (to.name === 'login' || to.name === 'register' || to.name === 'forgot-password')
    ) {
      return { name: 'home' }
    }
    return true
  }

  if (!store.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.meta.admin && !store.isAdmin) {
    return { name: 'home' }
  }

  return true
})

export default router
