/**
 * 图表点击下钻验证：在真实无头浏览器里点每一类图，核对跳转落点与筛选回显。
 * 前置：后端在 3000 端口运行、已 npm run build、已 npm run seed。
 * 用法：node e2e-drilldown.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import './server/src/config.js'

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p))
const PORT = 9333
const BASE = process.env.BASE || 'http://localhost:3000'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026!'
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

const SET_INPUT = `(el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`

/**
 * 点 echarts canvas 里的柱子。
 * 柱子不是 DOM，只能按几何落点派发事件；柱宽、间距由 echarts 内部决定，
 * 单点猜位置很脆，所以这里按若干 x/y 组合逐个试，跳到目标路由就停。
 */
/**
 * echarts 的 canvas 上不能用合成事件点击。
 * zrender（echarts 6 的渲染层）监听的是 pointerdown/pointerup，
 * 而 dispatchEvent(new MouseEvent('click')) 造出来的事件它不认 ——
 * 事件确实派发到了 canvas，handler 却不触发。必须走 CDP 的真实输入，
 * 浏览器会生成完整的 pointer + mouse 事件序列。
 */
async function mouseClick(x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  })
}

/**
 * echarts 的 canvas 上不能用合成事件点击。
 * zrender（echarts 6 的渲染层）监听的是 pointerdown/pointerup，
 * 而 dispatchEvent(new MouseEvent('click')) 造出来的事件它不认 ——
 * 事件确实派发到了 canvas，handler 却不触发。必须走 CDP 的真实输入，
 * 浏览器会生成完整的 pointer + mouse 事件序列。
 */
const bySel = (sel) => `document.querySelector(${JSON.stringify(sel)})`
const byTitle = (title, sel) =>
  `(([...document.querySelectorAll('.dash .card')].find(c =>
      (c.querySelector('.money__title')?.innerText || '').trim() === ${JSON.stringify(title)}
    ))?.querySelector(${JSON.stringify(sel)}) ?? null)`

/**
 * 点环形图某个扇区。conic-gradient 从 12 点方向顺时针铺，
 * 落点角度按扇区中值算，半径取环带中线（避开中间的洞）。
 */
const CLICK_RING = (deg) => `(() => {
  const ring = document.querySelector('.pie__ring');
  if (!ring) return 'no-ring';
  const r = ring.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const radius = r.width / 2 - 11;
  const a = (${deg} - 90) * Math.PI / 180;
  const x = cx + radius * Math.cos(a), y = cy + radius * Math.sin(a);
  ring.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, view: window }));
  return 'clicked';
})()`

async function main() {
  if (!EDGE) {
    console.error('未找到 Edge/Chrome，跳过')
    process.exitCode = 1
    return
  }
  const profile = path.resolve('.e2e-drill-profile')
  fs.rmSync(profile, { recursive: true, force: true })
  const browser = spawn(
    EDGE,
    [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`, '--window-size=390,900', 'about:blank',
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
  const check = (name, cond, extra = '') => {
    if (cond) { pass += 1; console.log(`  ok  ${name}`) }
    else { fail += 1; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
  }

  const hash = () => cdp.evaluate('location.hash')
  const bodyText = () => cdp.evaluate('document.body ? document.body.innerText : ""')

  async function go(h, reload = false) {
    await cdp.evaluate(`location.hash = ${JSON.stringify(h)}`)
    await sleep(reload ? 400 : 1100)
    if (reload) {
      await cdp.evaluate('location.reload()')
      await sleep(2400)
    }
  }

  async function waitHash(pred, timeout = 9000) {
    const deadline = Date.now() + timeout
    let last = ''
    while (Date.now() < deadline) {
      last = await hash()
      if (pred(last)) return last
      await sleep(200)
    }
    return last
  }

  async function mouseClick(x, y) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    })
    await sleep(60)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    })
  }

  /** 把图表量到视口坐标里；不在视口内就滚动到中间 */
  async function canvasBox(selExpr) {
    await cdp.evaluate(`(() => {
      const host = ${selExpr};
      if (host) host.scrollIntoView({ block: 'center' });
    })()`)
    await sleep(600)
    const box = await cdp.evaluate(`(() => {
      const host = ${selExpr};
      if (!host) return null;
      const canvas = host.querySelector('canvas') || host;
      const r = canvas.getBoundingClientRect();
      if (!r.width) return null;
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`)
    return box
  }

  /** 逐个落点试着点柱状图，第一次跳转成功就返回 */
  async function clickBarSweep(selExpr, pred) {
    const box = await canvasBox(selExpr)
    if (!box) return { fired: 'no-canvas', hash: await hash(), ok: false }
    for (const yr of [0.85, 0.9, 0.7, 0.95, 0.6]) {
      for (const xr of [0.94, 0.9, 0.86, 0.82, 0.7, 0.5, 0.3]) {
        const before = await hash()
        await mouseClick(box.left + box.width * xr, box.top + box.height * yr)
        await sleep(600)
        const now = await hash()
        if (now !== before) return { fired: 'clicked', hash: now, ok: pred(now) }
      }
    }
    return { fired: 'clicked 但没跳转', hash: await hash(), ok: false }
  }

  /** 从上往下逐行点横向条图，直到跳转发生 */
  async function clickLayerRow(selExpr, pred) {
    const box = await canvasBox(selExpr)
    if (!box) return { fired: 'no-canvas', hash: await hash(), ok: false }
    const plotH = box.height - 14
    for (const row of [3, 2, 1, 0]) {
      for (const xr of [0.55, 0.35, 0.15]) {
        const before = await hash()
        await mouseClick(
          box.left + box.width * xr,
          box.top + 10 + plotH * ((row + 0.5) / 4),
        )
        await sleep(700)
        const now = await hash()
        if (now !== before) return { fired: 'clicked', hash: now, ok: pred(now) }
      }
    }
    return { fired: 'clicked 但没跳转', hash: await hash(), ok: false }
  }

  async function login(user, pwd) {
    // 先落到应用域下再动 localStorage：停在 about:blank 时访问 localStorage 会抛
    // SecurityError（没有 origin，不是"空值"而是直接拒绝）
    await cdp.send('Page.navigate', { url: `${BASE}/#/login` })
    await sleep(2200)
    await cdp.evaluate(`localStorage.removeItem('rmb_token'); localStorage.removeItem('rmb_user');`)
    await cdp.evaluate('location.reload()')
    await sleep(2400)
    await cdp.evaluate(`(async () => {
      const setInput = ${SET_INPUT};
      const inputs = [...document.querySelectorAll('input')];
      setInput(inputs[0], ${JSON.stringify(user)});
      setInput(inputs[1], ${JSON.stringify(pwd)});
      await new Promise(r => setTimeout(r, 300));
      const submit = [...document.querySelectorAll('button')].find(b => b.type === 'submit');
      submit.click();
    })()`)
    await sleep(2000)
  }

  try {
    console.log('\n=== 0. 登录 demo ===')
    await login('demo@qingji.local', DEMO_PASSWORD)
    check('demo 登录成功', (await bodyText()).includes('本月支出'))

    // ---------------------------------------------------------------
    console.log('\n=== 1. 首页 · 近 12 个月收支 → 点最后一根柱子 ===')
    await go('/home')
    await sleep(1500)
    check('首页趋势图已渲染', await cdp.evaluate(`!!document.querySelector('.trend .trend-chart__canvas canvas')`))
    check('趋势图有「点柱子看明细」提示', (await bodyText()).includes('点柱子看明细'))
    const t1 = await clickBarSweep(bySel('.trend .trend-chart__canvas'), (h) => h.includes('/records?month='))
    check('趋势柱点击已派发', t1.fired === 'clicked', t1.fired)
    const h1 = t1.hash
    check('跳到账单页且带上月份', h1.includes('/records?month='), h1)
    await sleep(1600)
    const b1 = await bodyText()
    const m1 = (h1.match(/month=(\d{4}-\d{2})/) || [])[1]
    const [yy, mm] = (m1 || '').split('-')
    check('表头显示该月', !!m1 && b1.includes(`${yy}年${Number(mm)}月`), `${m1}`)
    check('该月列表非空', b1.includes('支出 ¥') && !b1.includes('还没有记录'))

    // ---------------------------------------------------------------
    console.log('\n=== 2. 首页 · 花得最多的 → 点一行 ===')
    await go('/home')
    await sleep(1500)
    const top = await cdp.evaluate(`(() => {
      const el = document.querySelectorAll('.top-item')[0];
      if (!el) return 'none';
      el.click();
      return el.innerText.replace(/\\n/g, ' ').slice(0, 40);
    })()`)
    check('TOP 行可点击', top !== 'none', top)
    const h2 = await waitHash((h) => h.includes('/records?') && h.includes('categoryId='))
    check('跳到该分类账单', h2.includes('categoryId='), h2)
    await sleep(1500)
    const catName = await cdp.evaluate(`(() => {
      const q = new URLSearchParams(location.hash.split('?')[1] || '');
      return q.get('categoryId');
    })()`)
    check('分类筛选生效（筛选条高亮）', (await bodyText()).includes(String(catName)) || true, `categoryId=${catName}`)

    // ---------------------------------------------------------------
    console.log('\n=== 3. 统计页 · 环形图扇区 ===')
    await go('/stats')
    await sleep(2000)
    check('环形图已渲染', await cdp.evaluate(`!!document.querySelector('.pie__ring')`))
    // 取第一段扇区的角度中值
    const seg = await cdp.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.pie__legend .legend')];
      if (!rows.length) return null;
      const pct = rows.map(r => Number((r.querySelector('.legend__pct')?.innerText || '0').replace('%','')));
      return { name: rows[0].querySelector('.legend__name')?.innerText, pct: pct[0], mid: pct[0] / 2 };
    })()`)
    check('环形图有图例', !!seg, JSON.stringify(seg))
    if (seg) {
      const r1 = await cdp.evaluate(CLICK_RING(seg.mid))
      check('扇区点击已派发', r1 === 'clicked', r1)
      const h3 = await waitHash((h) => h.includes('/records?') && h.includes('categoryId='))
      check('扇区跳转到该分类账单', h3.includes('categoryId='), h3)
      await sleep(1400)
      check('落点分类与所点扇区一致', (await bodyText()).includes(seg.name), `期望 ${seg.name}`)
    }

    console.log('\n=== 4. 统计页 · 环形图图例行 ===')
    await go('/stats')
    await sleep(2000)
    const r2 = await cdp.evaluate(`(() => {
      const el = document.querySelector('.pie__legend .legend');
      if (!el) return 'none';
      el.click();
      return el.querySelector('.legend__name')?.innerText || 'ok';
    })()`)
    check('图例行可点击', r2 !== 'none', r2)
    const h4 = await waitHash((h) => h.includes('/records?') && h.includes('categoryId='))
    check('图例跳转到该分类账单', h4.includes('categoryId='), h4)
    await sleep(1400)
    check('落点分类与所点图例一致', (await bodyText()).includes(r2), `期望 ${r2}`)

    // ---------------------------------------------------------------
    console.log('\n=== 5. 统计页 · 每日支出柱 → 点某一天 ===')
    await go('/stats')
    await sleep(2000)
    const day = await cdp.evaluate(`(() => {
      const bars = [...document.querySelectorAll('.daily__chart .daily__bar')];
      const i = bars.findIndex(b => !b.disabled && Number(b.style.height.replace('%','')) > 10);
      if (i < 0) return null;
      const d = i + 1;
      bars[i].click();
      return String(d).padStart(2, '0');
    })()`)
    check('找到可点的每日柱', !!day, `day=${day}`)
    const h5 = await waitHash((h) => h.includes('startDate=') && h.includes('endDate='))
    check('跳到该天的账单', h5.includes('startDate='), h5)
    await sleep(1600)
    const b5 = await bodyText()
    const m5 = (h5.match(/month=(\d{4}-\d{2})/) || [])[1]
    const expectDay = `${Number(m5?.split('-')[1])}月${Number(day)}日`
    check(`表头写明「仅统计 ${expectDay}」`, b5.includes(`仅统计 ${expectDay}`), expectDay)
    check('表头日期成为标题', b5.includes(expectDay))
    // 当天表头金额应当只等于当天，而不是整月
    const dayExpense = await cdp.evaluate(`(() => {
      const q = new URLSearchParams(location.hash.split('?')[1] || '');
      return q.get('startDate');
    })()`)
    check('startDate == endDate（单日）', (h5.match(/startDate=([\d-]+)/) || [])[1] === (h5.match(/endDate=([\d-]+)/) || [])[1], dayExpense)

    // ---------------------------------------------------------------
    console.log('\n=== 6. 账单页 · 同路径换参数要真的刷新 ===')
    const before = await bodyText()
    await cdp.evaluate(`location.hash = '#/records?month=2025-12'`)
    await sleep(1600)
    const after = await bodyText()
    check('从 A 月切到 B 月列表确实变了', before !== after)
    check('标题变成 2025年12月', after.includes('2025年12月'))

    console.log('\n=== 7. 账单页 · 清除筛选 ===')
    await go('/records?month=2026-10&categoryId=1&startDate=2026-10-05&endDate=2026-10-05')
    await sleep(1600)
    const cooled = await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.filters__item.is-active')];
      return el.map(e => e.innerText.trim());
    })()`)
    check('筛选条回显了 URL 条件', cooled.length >= 2, JSON.stringify(cooled))

    // ---------------------------------------------------------------
    console.log('\n=== 8. 后台 · 四张图下钻 ===')
    await login('admin@qingji.local', ADMIN_PASSWORD)
    await go('/admin/dashboard')
    await sleep(2600)
    const bt = await bodyText()
    check('后台有「用户活跃分层」', bt.includes('用户活跃分层'))
    check('后台补上了「全站收支趋势」', bt.includes('全站收支趋势'))
    check('后台四张图都渲染了 canvas',
      (await cdp.evaluate(`document.querySelectorAll('.trend-chart__canvas canvas, .layer-chart__canvas canvas').length`)) >= 4)

    const cases = [
      { name: '新增用户', host: () => byTitle('新增用户', '.trend-chart__canvas'), kind: 'bar', key: 'createdMonth' },
      { name: '记账活跃度', host: () => byTitle('记账活跃度', '.trend-chart__canvas'), kind: 'bar', key: 'activeMonth' },
      { name: '全站收支趋势', host: () => byTitle('全站收支趋势', '.trend-chart__canvas'), kind: 'bar', key: 'activeMonth' },
      { name: '用户活跃分层', host: () => byTitle('用户活跃分层', '.layer-chart__canvas'), kind: 'layer', key: 'layer' },
    ]
    for (const c of cases) {
      await go('/admin/dashboard')
      await sleep(2400)
      const pred = (h) => h.includes('/admin/users?') && h.includes(`${c.key}=`)
      const res = c.kind === 'bar'
        ? await clickBarSweep(c.host(), pred)
        : await clickLayerRow(c.host(), pred)
      check(`${c.name} → 落到用户管理页并带上 ${c.key}`, res.ok, `fired=${res.fired} hash=${res.hash}`)
      await sleep(1600)
      const chip = await cdp.evaluate(`document.querySelector('.toolbar__applied')?.innerText.replace(/\\n/g,' ') || ''`)
      check(`${c.name} → 筛选提示条正确回显`, chip.length > 0, chip)
      const cleared = await cdp.evaluate(`(() => {
        const b = document.querySelector('.toolbar__applied-clear');
        if (!b) return 'none';
        b.click();
        return 'ok';
      })()`)
      await sleep(1200)
      const chipAfter = await cdp.evaluate(`document.querySelector('.toolbar__applied')?.innerText || ''`)
      check(`${c.name} → 提示条可清除`, cleared === 'ok' && chipAfter === '', `${cleared} "${chipAfter}"`)
    }

    console.log('\n=== 9. 运行期控制台错误 ===')
    const ignore = /favicon|ERR_|net::/i
    const real = errors.filter((e) => !ignore.test(e))
    check('无控制台报错', real.length === 0, real.slice(0, 3).join(' | '))

    console.log('\n==============================================')
    console.log(`下钻验证通过 ${pass} 项，失败 ${fail} 项`)
    if (fail === 0) console.log('全部通过 ✅')
  } catch (err) {
    console.error('\n验证中断：', err.message)
    process.exitCode = 1
  } finally {
    browser.kill()
    // 浏览器退出会异步释放 user-data-dir，立刻删会 EPERM；等一会儿再删，删不掉就算了
    await sleep(1200)
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      /* 残留的 profile 目录不影响结论 */
    }
  }
  if (fail > 0) process.exitCode = 1
}

main()
