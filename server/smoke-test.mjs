/**
 * 接口冒烟测试：覆盖注册登录、记账、筛选、预算、统计、数据隔离、管理员后台。
 * 需要后端已在 3000 端口运行。用法：node smoke-test.mjs
 */
import './src/config.js'

const BASE = process.env.BASE || 'http://localhost:3000/api'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
let pass = 0
let fail = 0
const failures = []

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1
    console.log(`  ok  ${name}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`  FAIL ${name} ${extra}`)
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

// 用户名最长 20 位，所以时间戳取后 8 位即可保证唯一
const shortStamp = String(Date.now()).slice(-8)
const userA = `ta_${shortStamp}`
const userB = `tb_${shortStamp}`
const month = new Date().toISOString().slice(0, 7)

async function main() {
  console.log('\n=== 1. 健康检查 ===')
  const health = await api('/health')
  check('健康检查返回 OK', health.code === 'OK', JSON.stringify(health))

  console.log('\n=== 2. 注册与校验 ===')
  const badName = await api('/auth/register', {
    method: 'POST',
    body: { username: '1abc', password: 'abc123', nickname: 'A' },
  })
  check('非法用户名被拒绝', badName.status === 400, `status=${badName.status}`)

  const shortPwd = await api('/auth/register', {
    method: 'POST',
    body: { username: userA, password: '123', nickname: 'A' },
  })
  check('过短密码被拒绝', shortPwd.status === 400, shortPwd.message)

  const regA = await api('/auth/register', {
    method: 'POST',
    body: { username: userA, password: 'test123', nickname: '测试A' },
  })
  check('用户 A 注册成功', regA.code === 'OK', regA.message)
  check('注册不返回 token（注册后不自动登录）', regA.data?.token === undefined, JSON.stringify(regA.data))
  check('注册返回用户名', regA.data?.user?.username === userA, JSON.stringify(regA.data?.user))

  const dup = await api('/auth/register', {
    method: 'POST',
    body: { username: userA, password: 'test123', nickname: '测试A2' },
  })
  check('重复用户名被拒绝', dup.status === 409, `status=${dup.status}`)

  const regB = await api('/auth/register', {
    method: 'POST',
    body: { username: userB, password: 'test123', nickname: '测试B' },
  })
  check('用户 B 注册成功', regB.code === 'OK')

  // 注册后必须自己登录才能拿到 token
  const loginA = await api('/auth/login', {
    method: 'POST',
    body: { username: userA, password: 'test123' },
  })
  check('正确密码登录成功', loginA.code === 'OK')
  const loginB = await api('/auth/login', {
    method: 'POST',
    body: { username: userB, password: 'test123' },
  })
  check('用户 B 登录成功', loginB.code === 'OK')

  const tokenA = loginA.data.token
  const tokenB = loginB.data.token

  const badLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: userA, password: 'wrongpass' },
  })
  check('错误密码登录被拒绝', badLogin.status === 401, `status=${badLogin.status}`)

  const noAuth = await api('/records')
  check('未登录访问记录被拒绝', noAuth.status === 401, `status=${noAuth.status}`)

  console.log('\n=== 3. 默认分类 ===')
  const catsA = await api('/categories', { token: tokenA })
  check('注册后自动获得默认分类', catsA.data?.length >= 10, `count=${catsA.data?.length}`)
  const expenseCat = catsA.data.find((c) => c.type === 'expense')
  const incomeCat = catsA.data.find((c) => c.type === 'income')
  check('存在支出分类', !!expenseCat)
  check('存在收入分类', !!incomeCat)

  console.log('\n=== 4. 记一笔：金额与分类校验 ===')
  const negAmount = await api('/records', {
    method: 'POST',
    token: tokenA,
    body: { type: 'expense', amount: '-5', categoryId: expenseCat.id, date: `${month}-10` },
  })
  check('负数金额被拒绝', negAmount.status === 400, negAmount.message)

  const zeroAmount = await api('/records', {
    method: 'POST',
    token: tokenA,
    body: { type: 'expense', amount: '0', categoryId: expenseCat.id, date: `${month}-10` },
  })
  check('金额为 0 被拒绝', zeroAmount.status === 400, zeroAmount.message)

  const threeDecimals = await api('/records', {
    method: 'POST',
    token: tokenA,
    body: { type: 'expense', amount: '1.234', categoryId: expenseCat.id, date: `${month}-10` },
  })
  check('超过两位小数被拒绝', threeDecimals.status === 400, threeDecimals.message)

  const mismatched = await api('/records', {
    method: 'POST',
    token: tokenA,
    body: { type: 'income', amount: '100', categoryId: expenseCat.id, date: `${month}-10` },
  })
  check('分类与类型不匹配被拒绝', mismatched.status === 400, mismatched.message)

  const badDate = await api('/records', {
    method: 'POST',
    token: tokenA,
    body: { type: 'expense', amount: '100', categoryId: expenseCat.id, date: '2026-02-31' },
  })
  check('不存在的日期被拒绝', badDate.status === 400, badDate.message)

  // 正常记账
  const r1 = await api('/records', {
    method: 'POST',
    token: tokenA,
    body: { type: 'expense', amount: '88.88', categoryId: expenseCat.id, date: `${month}-10`, note: '午饭' },
  })
  check('新增支出成功', r1.code === 'OK', r1.message)
  check('金额以分为单位存储', r1.data?.amount === 8888, `amount=${r1.data?.amount}`)

  const r2 = await api('/records', {
    method: 'POST',
    token: tokenA,
    body: { type: 'income', amount: '5000', categoryId: incomeCat.id, date: `${month}-05`, note: '工资' },
  })
  check('新增收入成功', r2.code === 'OK' && r2.data?.amount === 500000)

  console.log('\n=== 5. 统计计算 ===')
  const overview = await api(`/stats/overview?month=${month}`, { token: tokenA })
  check('首页支出合计正确', overview.data?.expense === 8888, `expense=${overview.data?.expense}`)
  check('首页收入合计正确', overview.data?.income === 500000, `income=${overview.data?.income}`)
  check('结余 = 收入 - 支出', overview.data?.balance === 500000 - 8888, `balance=${overview.data?.balance}`)
  check('预算未设置时返回 null', overview.data?.budget?.amount === null)

  const summary = await api(`/stats/summary?month=${month}`, { token: tokenA })
  check('统计页返回分类占比', summary.data?.expenseByCategory?.length >= 1)
  const pct = summary.data?.expenseByCategory?.[0]?.percent
  check('分类占比为 100%', pct === 100, `percent=${pct}`)
  check('统计按发生日期归月', summary.data?.recordCount === 2, `count=${summary.data?.recordCount}`)

  console.log('\n=== 6. 筛选 ===')
  const onlyExpense = await api(`/records?month=${month}&type=expense`, { token: tokenA })
  check('按类型筛选支出', onlyExpense.data?.total === 1, `total=${onlyExpense.data?.total}`)

  const byCat = await api(`/records?month=${month}&categoryId=${incomeCat.id}`, { token: tokenA })
  check('按分类筛选', byCat.data?.total === 1, `total=${byCat.data?.total}`)

  const byKeyword = await api(`/records?month=${month}&keyword=午饭`, { token: tokenA })
  check('按备注关键字筛选', byKeyword.data?.total === 1, `total=${byKeyword.data?.total}`)

  const otherMonth = await api('/records?month=2020-01', { token: tokenA })
  check('其他月份无数据', otherMonth.data?.total === 0)

  console.log('\n=== 7. 修改与删除 ===')
  const updated = await api(`/records/${r1.data.id}`, {
    method: 'PUT',
    token: tokenA,
    body: { amount: '99.99' },
  })
  check('修改金额成功', updated.data?.amount === 9999, `amount=${updated.data?.amount}`)

  const afterUpdate = await api(`/stats/overview?month=${month}`, { token: tokenA })
  check('修改后统计同步更新', afterUpdate.data?.expense === 9999, `expense=${afterUpdate.data?.expense}`)

  console.log('\n=== 8. 预算 ===')
  const setBudget = await api('/budgets', {
    method: 'PUT',
    token: tokenA,
    body: { month, amount: '500' },
  })
  check('设置预算成功', setBudget.data?.amount === 50000, `amount=${setBudget.data?.amount}`)
  check('预算已用金额正确', setBudget.data?.spent === 9999, `spent=${setBudget.data?.spent}`)
  check('预算状态为 normal', setBudget.data?.status === 'normal', `status=${setBudget.data?.status}`)

  const zeroBudget = await api('/budgets', {
    method: 'PUT',
    token: tokenA,
    body: { month, amount: '0' },
  })
  check('预算可以为 0', zeroBudget.code === 'OK' && zeroBudget.data?.amount === 0)
  check('预算为 0 且有支出时为超支', zeroBudget.data?.status === 'exceeded', `status=${zeroBudget.data?.status}`)

  const negBudget = await api('/budgets', {
    method: 'PUT',
    token: tokenA,
    body: { month, amount: '-100' },
  })
  check('负数预算被拒绝', negBudget.status === 400)

  const exceeded = await api('/budgets', {
    method: 'PUT',
    token: tokenA,
    body: { month, amount: '50' },
  })
  check('超预算状态标记正确', exceeded.data?.status === 'exceeded', `status=${exceeded.data?.status}`)

  console.log('\n=== 9. 分类管理约束 ===')
  const newCat = await api('/categories', {
    method: 'POST',
    token: tokenA,
    body: { type: 'expense', name: '宠物', icon: '🐱', color: '#F06595' },
  })
  check('新增自定义分类成功', newCat.code === 'OK')

  const dupCat = await api('/categories', {
    method: 'POST',
    token: tokenA,
    body: { type: 'expense', name: '宠物' },
  })
  check('同名分类被拒绝', dupCat.status === 409, `status=${dupCat.status}`)

  const delUsed = await api(`/categories/${expenseCat.id}`, { method: 'DELETE', token: tokenA })
  check('已被使用的分类不可删除', delUsed.status === 409, `status=${delUsed.status}`)
  check('提示了记录数量', String(delUsed.message).includes('条记录'), delUsed.message)

  const delUnused = await api(`/categories/${newCat.data.id}`, { method: 'DELETE', token: tokenA })
  check('未使用的分类可以删除', delUnused.code === 'OK')

  console.log('\n=== 10. 数据隔离 ===')
  const bList = await api(`/records?month=${month}`, { token: tokenB })
  check('B 看不到 A 的记录', bList.data?.total === 0, `total=${bList.data?.total}`)

  const bHackRead = await api(`/records/${r2.data.id}`, { token: tokenB })
  check('B 无法读取 A 的单条记录', bHackRead.status === 404, `status=${bHackRead.status}`)

  const bHackUpdate = await api(`/records/${r2.data.id}`, {
    method: 'PUT',
    token: tokenB,
    body: { amount: '1' },
  })
  check('B 无法修改 A 的记录', bHackUpdate.status === 404, `status=${bHackUpdate.status}`)

  const bHackDelete = await api(`/records/${r2.data.id}`, { method: 'DELETE', token: tokenB })
  check('B 无法删除 A 的记录', bHackDelete.status === 404, `status=${bHackDelete.status}`)

  const bHackCatUse = await api('/records', {
    method: 'POST',
    token: tokenB,
    body: { type: 'expense', amount: '10', categoryId: expenseCat.id, date: `${month}-10` },
  })
  check('B 无法使用 A 的分类记账', bHackCatUse.status === 404, `status=${bHackCatUse.status}`)

  const bHackDelCat = await api(`/categories/${incomeCat.id}`, { method: 'DELETE', token: tokenB })
  check('B 无法删除 A 的分类', bHackDelCat.status === 404, `status=${bHackDelCat.status}`)

  const bBudget = await api(`/budgets?month=${month}`, { token: tokenB })
  check('B 看不到 A 的预算', bBudget.data?.amount === null)

  console.log('\n=== 11. 管理员后台 ===')
  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: ADMIN_PASSWORD },
  })
  check('管理员登录成功', adminLogin.code === 'OK')
  const adminToken = adminLogin.data?.token
  check('管理员角色正确', adminLogin.data?.user?.role === 'admin')

  const adminDenied = await api('/admin/overview', { token: tokenA })
  check('普通用户访问后台被拒绝', adminDenied.status === 403, `status=${adminDenied.status}`)

  const adminOverview = await api('/admin/overview', { token: adminToken })
  check('管理员可查看总览', adminOverview.code === 'OK')
  check('总览统计到新注册用户', adminOverview.data?.userCount >= 3, `count=${adminOverview.data?.userCount}`)

  const adminUsers = await api('/admin/users?pageSize=50', { token: adminToken })
  check('管理员可查看用户列表', adminUsers.code === 'OK')
  check('用户列表包含新增用户', adminUsers.data?.items?.some((u) => u.username === userA))

  const adminCharts = await api('/admin/charts?months=6', { token: adminToken })
  check(
    '管理员可查看全站收支趋势',
    adminCharts.code === 'OK' && adminCharts.data?.length === 6,
  )
  // 后台只提供聚合分析：逐条浏览他人账目与 PRD 4.1 的数据隔离原则冲突，接口被刻意移除
  const adminRecords = await api('/admin/records?pageSize=50', { token: adminToken })
  check('后台不提供逐笔账单', adminRecords.status === 404, `status=${adminRecords.status}`)

  const selfDisable = await api(`/admin/users/${adminLogin.data.user.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { status: 'disabled' },
  })
  check('管理员不能停用自己', selfDisable.status === 400, `status=${selfDisable.status}`)

  const selfRole = await api(`/admin/users/${adminLogin.data.user.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { role: 'user' },
  })
  check('管理员不能给自己降级', selfRole.status === 400, `status=${selfRole.status}`)

  const disableB = await api(`/admin/users/${regB.data.user.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { status: 'disabled' },
  })
  check('管理员可停用用户', disableB.code === 'OK')

  const disabledLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: userB, password: 'test123' },
  })
  check('被停用用户无法登录', disabledLogin.status === 403, `status=${disabledLogin.status}`)

  const disabledAccess = await api('/records', { token: tokenB })
  check('被停用用户的旧 token 失效', disabledAccess.status === 403, `status=${disabledAccess.status}`)

  const reEnable = await api(`/admin/users/${regB.data.user.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { status: 'active' },
  })
  check('管理员可恢复用户', reEnable.code === 'OK')

  const delUser = await api(`/admin/users/${regB.data.user.id}`, {
    method: 'DELETE',
    token: adminToken,
  })
  check('管理员可删除用户', delUser.code === 'OK')

  const delSelf = await api(`/admin/users/${adminLogin.data.user.id}`, {
    method: 'DELETE',
    token: adminToken,
  })
  check('管理员不能删除自己', delSelf.status === 400, `status=${delSelf.status}`)

  console.log('\n=== 12. 修改密码 ===')
  const wrongOld = await api('/auth/change-password', {
    method: 'POST',
    token: tokenA,
    body: { oldPassword: 'wrongpass', newPassword: 'newpass123' },
  })
  check('原密码错误被拒绝', wrongOld.status === 400, `status=${wrongOld.status}`)

  const changed = await api('/auth/change-password', {
    method: 'POST',
    token: tokenA,
    body: { oldPassword: 'test123', newPassword: 'newpass123' },
  })
  check('修改密码成功', changed.code === 'OK')

  const oldToken = await api('/auth/me', { token: tokenA })
  check('改密码后旧 token 失效', oldToken.status === 401, `status=${oldToken.status}`)

  const newLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: userA, password: 'newpass123' },
  })
  check('新密码可以登录', newLogin.code === 'OK')

  console.log('\n=== 13. 删除记录 ===')
  const tokenA2 = newLogin.data.token
  const del = await api(`/records/${r1.data.id}`, { method: 'DELETE', token: tokenA2 })
  check('删除记录成功', del.code === 'OK')

  const afterDel = await api(`/stats/overview?month=${month}`, { token: tokenA2 })
  check('删除后统计同步更新', afterDel.data?.expense === 0, `expense=${afterDel.data?.expense}`)

  const delAgain = await api(`/records/${r1.data.id}`, { method: 'DELETE', token: tokenA2 })
  check('重复删除返回 404', delAgain.status === 404, `status=${delAgain.status}`)

  console.log('\n=== 14. 月份切换统计 ===')
  const lastMonth = new Date()
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  const prevMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`
  await api('/records', {
    method: 'POST',
    token: tokenA2,
    body: { type: 'expense', amount: '120', categoryId: expenseCat.id, date: `${prevMonth}-15` },
  })
  const thisMonthStats = await api(`/stats/overview?month=${month}`, { token: tokenA2 })
  const prevMonthStats = await api(`/stats/overview?month=${prevMonth}`, { token: tokenA2 })
  check('本月统计不含上月记录', thisMonthStats.data?.expense === 0, `expense=${thisMonthStats.data?.expense}`)
  check('上月统计包含上月记录', prevMonthStats.data?.expense === 12000, `expense=${prevMonthStats.data?.expense}`)

  console.log('\n=== 15. 清理测试账号 ===')
  // 每跑一次测试都留一个 ta_xxx 用户会污染后台用户列表，最后连同其账目一并删除
  const cleanupA = await api(`/admin/users/${regA.data.user.id}`, {
    method: 'DELETE',
    token: adminToken,
  })
  check('测试账号已清理', cleanupA.code === 'OK', cleanupA.code)

  console.log(`\n${'='.repeat(46)}`)
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  if (fail) {
    console.log(`失败项：\n  - ${failures.join('\n  - ')}`)
    process.exitCode = 1
  } else {
    console.log('全部通过 ✅')
  }
}

main().catch((err) => {
  console.error('\n测试异常中断：', err)
  process.exitCode = 1
})
