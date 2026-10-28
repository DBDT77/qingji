/**
 * 端到端渲染验证：用 CDP 驱动无头浏览器走一遍真实用户流程。
 * 登录 -> 首页 -> 记一笔（真实提交）-> 账单 -> 统计 -> 分类 -> 预算 -> 我的 -> 后台。
 * 每个页面检查关键文案是否渲染、记账后金额是否真的变了、控制台有无报错。
 *
 * 前置：后端已在 3000 端口运行，且已执行 npm run build。
 * 注册用例需要后端处于开发模式（EMAIL_DEV_MODE=true，验证码回填页面）；
 * 若配置了真实 SMTP，注册一段会自动跳过，其余流程照常验证。
 * 用法：node e2e-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import './server/src/config.js'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026!'

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p))
const PORT = 9222
const BASE = process.env.BASE || 'http://localhost:3000'
const SHOTS = path.resolve('shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg))
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 30000)
    })
  }

  on(fn) {
    this.listeners.push(fn)
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || '页面脚本异常')
    }
    return res.result?.value
  }
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error(`WebSocket 连接失败: ${url}`)))
  })
}

async function findPageTarget() {
  for (let i = 0; i < 40; i += 1) {
    await sleep(400)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* 浏览器还没就绪 */
    }
  }
  return null
}

async function main() {
  if (!EDGE) {
    console.error('未找到 Edge/Chrome，跳过端到端验证')
    process.exitCode = 1
    return
  }
  fs.mkdirSync(SHOTS, { recursive: true })
  const profile = path.resolve('.e2e-profile')
  fs.rmSync(profile, { recursive: true, force: true })

  const browser = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=390,844',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const wsUrl = await findPageTarget()
  if (!wsUrl) {
    console.error('无法连接无头浏览器')
    browser.kill()
    process.exitCode = 1
    return
  }

  const cdp = new Cdp(await openWs(wsUrl))
  const errors = []
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || '运行时异常')
    }
  })
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  let pass = 0
  let fail = 0
  const failures = []
  const check = (name, cond, extra = '') => {
    if (cond) {
      pass += 1
      console.log(`  ok  ${name}`)
    } else {
      fail += 1
      failures.push(name)
      console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`)
    }
  }

  const bodyText = () => cdp.evaluate('document.body ? document.body.innerText : ""')

  async function waitForText(text, timeout = 12000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        if (await cdp.evaluate(`(document.body?.innerText || "").includes(${JSON.stringify(text)})`)) {
          return true
        }
      } catch {
        /* 页面可能正在导航 */
      }
      await sleep(250)
    }
    return false
  }

  /** 跳到某个 hash 路由。reload=true 时额外整页刷新，用于清掉内存里的登录态 */
  async function go(hash, reload = false) {
    await cdp.evaluate(`location.hash = ${JSON.stringify(hash)}`)
    if (reload) {
      // Page.navigate 到只差 fragment 的 URL 不会重新加载页面，所以这里用 reload
      await sleep(300)
      await cdp.evaluate('location.reload()')
      await sleep(2200)
    } else {
      await sleep(1000)
    }
  }

  async function shot(name) {
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
    } catch (err) {
      console.log(`  (截图失败 ${name}: ${err.message})`)
    }
  }

  /** 把值写进受控 input（需要触发原生 input 事件，Vue 才能收到） */
  const SET_INPUT = `(el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }`

  const fetchExpense = `(async () => {
    const month = new Date().toISOString().slice(0, 7);
    const r = await fetch('/api/stats/overview?month=' + month, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('rmb_token') }
    });
    return (await r.json()).data.expense;
  })()`

  try {
    console.log('\n=== 1. 登录页渲染 ===')
    await cdp.send('Page.navigate', { url: `${BASE}/#/login` })
    await sleep(2500)
    check('登录页显示品牌名', await waitForText('轻记'))
    check('登录页有登录按钮', await waitForText('登录'))
    check('登录页有忘记密码入口', await waitForText('忘记密码'))
    await shot('01-login')

    console.log('\n=== 1b. 邮箱注册（注册后不自动登录） ===')
    const stamp = String(Date.now()).slice(-8)
    const newEmail = `e2e_${stamp}@example.com`
    await go('/register')
    check('注册页渲染', await waitForText('创建你的账本'))
    const registered = await cdp.evaluate(`(async () => {
      const setInput = ${SET_INPUT};
      const inputs = [...document.querySelectorAll('input')];
      if (inputs.length < 5) return 'no-inputs:' + inputs.length;
      setInput(inputs[0], ${JSON.stringify(newEmail)});
      await new Promise(r => setTimeout(r, 200));
      const sendBtn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('获取验证码'));
      if (!sendBtn) return 'no-send-button';
      sendBtn.click();
      // 开发模式会自动把验证码填进第二个输入框
      let code = '';
      for (let i = 0; i < 40; i += 1) {
        await new Promise(r => setTimeout(r, 250));
        code = inputs[1]?.value || '';
        if (/^\\d{6}$/.test(code)) break;
      }
      if (!/^\\d{6}$/.test(code)) return 'no-dev-code';
      setInput(inputs[2], '端到端新人');
      setInput(inputs[3], 'test123');
      setInput(inputs[4], 'test123');
      await new Promise(r => setTimeout(r, 300));
      const submit = [...document.querySelectorAll('button')].find(b => b.type === 'submit');
      if (!submit) return 'no-submit';
      submit.click();
      return 'ok';
    })()`)
    check('注册表单已提交（需要开发模式自动填码）', registered === 'ok', registered)
    let registeredUserId = null
    if (registered !== 'ok') {
      // 后端配置了真实 SMTP（EMAIL_DEV_MODE=auto/false）时验证码只发到邮箱，
      // 页面拿不到 devCode，注册流程无法自动化。跳过这组断言，后续流程照常验证，
      // 避免一个环境差异就让整套 e2e 崩掉。
      console.log('  (跳过注册后续步骤：后端未处于开发模式，验证码不会回填到页面)')
    } else {
      check('注册后显示成功页（不是直接进首页）', await waitForText('注册成功'))
      check('注册后仍停留在未登录状态', !(await waitForText('本月结余', 2000)))
      const tokenAfterReg = await cdp.evaluate(`localStorage.getItem('rmb_token') || ''`)
      check('注册后没有写入 token', tokenAfterReg === '', `token=${tokenAfterReg}`)
      await shot('01b-register-done')

      console.log('\n=== 1c. 注册成功后需重新输入密码登录 ===')
      const loggedIn = await cdp.evaluate(`(async () => {
        const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '去登录');
        if (!btn) return 'no-button';
        btn.click();
        await new Promise(r => setTimeout(r, 1200));
        return 'ok';
      })()`)
      check('点击「去登录」', loggedIn === 'ok', loggedIn)
      // 关键：注册后不自动登录，也不预填密码，必须回到登录页重新输入
      check('跳转到登录页', await waitForText('立即注册'))
      const prefill = await cdp.evaluate(`(() => {
        const inputs = [...document.querySelectorAll('input')];
        return { email: inputs[0]?.value || '', password: inputs[1]?.value || '' };
      })()`)
      check('登录页带上了邮箱', prefill.email === newEmail, JSON.stringify(prefill))
      check('登录页密码为空（需重新输入）', prefill.password === '', `pwd=${prefill.password}`)
      const typed = await cdp.evaluate(`(async () => {
        const setInput = ${SET_INPUT};
        const inputs = [...document.querySelectorAll('input')];
        setInput(inputs[1], 'test123');
        await new Promise(r => setTimeout(r, 300));
        const submit = [...document.querySelectorAll('button')].find(b => b.type === 'submit');
        if (!submit) return 'no-submit';
        submit.click();
        return 'ok';
      })()`)
      check('重新输入密码后登录', typed === 'ok', typed)
      check('登录后进入首页', await waitForText('本月结余'))

      console.log('\n=== 1d. 新用户有默认分类 ===')
      const newCats = await cdp.evaluate(`(async () => {
        const t = localStorage.getItem('rmb_token');
        const r = await fetch('/api/categories', { headers: { Authorization: 'Bearer ' + t } });
        return (await r.json()).data.length;
      })()`)
      check('新注册用户自动获得默认分类', newCats >= 10, `count=${newCats}`)

      // 记下账号 id，最后用管理员身份删掉，避免每跑一次就多一个 e2e_xxx 用户
      registeredUserId = await cdp.evaluate(`(async () => {
        const t = localStorage.getItem('rmb_token');
        if (!t) return null;
        const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } });
        return (await r.json()).data?.id || null;
      })()`)
    }

    console.log('\n=== 2. 真实登录 ===')
    // 上一段已经把新用户登录了，这里先退出，回到真正的"未登录"状态再测登录
    await cdp.evaluate(`localStorage.removeItem('rmb_token'); localStorage.removeItem('rmb_user');`)
    // 必须整页刷新：只改 hash 的话，内存里的 store 还认为已登录，路由守卫会把我们送回首页
    await go('/login', true)
    const clicked = await cdp.evaluate(`(async () => {
      const setInput = ${SET_INPUT};
      const inputs = [...document.querySelectorAll('input')];
      if (inputs.length < 2) return 'no-inputs';
      setInput(inputs[0], 'demo@qingji.local');
      setInput(inputs[1], DEMO_PASSWORD);
      await new Promise(r => setTimeout(r, 300));
      const btns = [...document.querySelectorAll('button')];
      const submit = btns.find(b => b.type === 'submit');
      if (!submit) return 'no-submit';
      submit.click();
      return 'ok';
    })()`)
    check('登录表单已提交', clicked === 'ok', clicked)
    check('demo 登录后进入首页', await waitForText('本月结余'))
    // 首页主数字改成本月支出，结余降级为次要行（上面那条仍断言到「本月结余」）
    check('首页主数字为本月支出', await waitForText('本月支出'))
    check('首页有快捷记账入口', await waitForText('记支出'))
    check(
      'tabbar 中央有记账按钮',
      await cdp.evaluate(`!!document.querySelector('.tabbar-add')`),
    )
    check(
      '首页趋势图已渲染',
      await cdp.evaluate(`document.querySelector('.trend-chart canvas')?.offsetWidth > 0`),
    )
    await shot('02-home')

    console.log('\n=== 3. 记一笔（真实提交并核对金额） ===')
    const before = await cdp.evaluate(fetchExpense)
    await go('/record/new')
    check('记账页渲染', await waitForText('餐饮'))
    const saved = await cdp.evaluate(`(async () => {
      const setInput = ${SET_INPUT};
      const input = document.querySelector('.amount__input');
      if (!input) return 'no-amount-input';
      setInput(input, '66.66');
      await new Promise(r => setTimeout(r, 200));
      const note = document.querySelector('.form__input');
      if (note) setInput(note, '端到端测试');
      const cats = [...document.querySelectorAll('.cat')];
      if (cats.length) cats[0].click();
      await new Promise(r => setTimeout(r, 200));
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.type === 'submit' && b.innerText.includes('保存'));
      if (!btn) return 'no-save-button';
      btn.click();
      return 'ok';
    })()`)
    check('记账表单已提交', saved === 'ok', saved)
    await sleep(1800)
    const after = await cdp.evaluate(fetchExpense)
    check('支出金额增加 6666 分（66.66 元）', after - before === 6666, `before=${before} after=${after}`)
    await go('/home')
    check('首页出现刚记的备注', await waitForText('端到端测试'))
    await shot('03-home-after-add')

    console.log('\n=== 4. 账单页 ===')
    await go('/records')
    check('账单页渲染', await waitForText('全部'))
    check('账单页出现刚记的备注', await waitForText('端到端测试'))
    await shot('04-records')

    console.log('\n=== 5. 统计页 ===')
    await go('/stats')
    check('统计页渲染', await waitForText('支出构成'))
    check('统计页有环形图', await cdp.evaluate(`!!document.querySelector('.pie__ring')`))
    check('统计页有每日柱状图', await cdp.evaluate(`!!document.querySelector('.daily__chart')`))
    check('统计页有最大单笔', await waitForText('最大单笔'))
    await shot('05-stats')

    console.log('\n=== 6. 分类管理 ===')
    await go('/categories')
    check('分类页渲染', await waitForText('分类管理'))
    check('分类页列出系统默认分类', await waitForText('系统默认'))
    await shot('06-categories')

    console.log('\n=== 7. 预算页 ===')
    await go('/budget')
    check('预算页渲染', await waitForText('月度预算'))
    check('预算页显示剩余额度', await waitForText('还可花'))
    await shot('07-budget')

    console.log('\n=== 8. 我的 ===')
    await go('/mine')
    check('我的页渲染', await waitForText('演示用户'))
    check('我的页有退出登录', await waitForText('退出登录'))
    await shot('08-mine')

    console.log('\n=== 9. 权限：普通用户进不了后台 ===')
    await go('/admin/dashboard')
    check('普通用户被挡在后台外', !(await waitForText('注册用户', 2500)))

    console.log('\n=== 10. 管理员后台 ===')
    await cdp.evaluate(`(async () => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@qingji.local', password: ADMIN_PASSWORD })
      });
      const j = await r.json();
      localStorage.setItem('rmb_token', j.data.token);
      localStorage.setItem('rmb_user', JSON.stringify(j.data.user));
      return 'ok';
    })()`)
    await cdp.evaluate('location.reload()')
    await sleep(2500)
    await cdp.send('Page.navigate', { url: `${BASE}/#/admin/dashboard` })
    await sleep(2000)
    check('后台总览渲染', await waitForText('注册用户'))
    check('后台显示排行榜', await waitForText('记账排行榜'))
    // 后台改为聚合分析型：用图表反映系统用户情况
    check('后台有新增用户图', await waitForText('新增用户'))
    check('后台有活跃度图', await waitForText('记账活跃度'))
    check('后台有用户活跃分层', await waitForText('用户活跃分层'))
    check(
      '后台图表已渲染',
      await cdp.evaluate(`document.querySelectorAll('.trend-chart canvas, .layer-chart canvas').length > 0`),
    )
    await shot('09-admin-dashboard')

    await go('/admin/users')
    check('后台用户列表渲染', await waitForText('新建用户'))
    check('后台列出演示用户', await waitForText('@demo'))
    await shot('10-admin-users')

    console.log('\n=== 11. 清理本次测试写入的账目 ===')
    // 测试通过界面真实提交了一笔（备注「端到端测试」）。不清理的话每跑一次
    // demo 的账本就多一条假账，用户翻到账单时看到的就是「数据不符合实际」。
    const cleaned = await cdp.evaluate(`(async () => {
      // 这里已经在后台页，localStorage 里是管理员 token；测试账目记在 demo 名下，
      // 所以重新登录 demo，避免拿错账号一条都清不掉。
      const login = await (await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@qingji.local', password: DEMO_PASSWORD }),
      })).json();
      const t = login.data?.token;
      const h = { Authorization: 'Bearer ' + t };
      const month = new Date().toISOString().slice(0, 7);
      const list = await (await fetch('/api/records?month=' + month + '&pageSize=200', { headers: h })).json();
      const mine = (list.data.items || []).filter(r => r.note === '端到端测试' && r.amount === 6666);
      for (const r of mine) await fetch('/api/records/' + r.id, { method: 'DELETE', headers: h });
      return mine.length;
    })()`)
    check('测试账目已清理', cleaned >= 1, `清理 ${cleaned} 条`)

    if (registeredUserId) {
      // 注册用例也会留下一个 e2e_xxx 账号，用管理员接口一并删掉
      const removed = await cdp.evaluate(`(async () => {
        const login = await (await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@qingji.local', password: ADMIN_PASSWORD }),
        })).json();
        const t = login.data?.token;
        if (!t) return 'no-admin-token';
        const r = await fetch('/api/admin/users/' + ${registeredUserId}, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + t },
        });
        return (await r.json()).code;
      })()`)
      check('测试账号已清理', removed === 'OK', removed)
    }

    console.log('\n=== 12. 运行期控制台错误 ===')
    const meaningful = errors.filter(
      (e) => !/favicon|ResizeObserver|Vue Devtools|Download the Vue/i.test(e),
    )
    check('无控制台报错', meaningful.length === 0, meaningful.slice(0, 3).join(' | '))
  } finally {
    browser.kill()
    // 浏览器退出会异步释放 user-data-dir，等一会儿再删，删不掉就算了
    await sleep(1200)
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      /* 残留 profile 不影响测试结果 */
    }
  }

  console.log(`\n${'='.repeat(46)}`)
  console.log(`端到端通过 ${pass} 项，失败 ${fail} 项`)
  if (fail) {
    console.log(`失败项：\n  - ${failures.join('\n  - ')}`)
    process.exitCode = 1
  } else {
    console.log('全部通过 ✅')
  }
}

main().catch((err) => {
  console.error('\n端到端测试异常：', err)
  process.exitCode = 1
})
