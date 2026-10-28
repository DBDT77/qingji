/**
 * 生成完整的运行截图集：把每个页面 + 每处图表点击的下钻落点都截一遍。
 * 前置：后端在 3000 端口运行、已 npm run build、已 npm run seed。
 * 用法：node capture-shots.mjs
 * 产出：shots/ 下的 PNG（按 01 ~ 20 命名，目录里会先清空）
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
const PORT = 9777
const BASE = process.env.BASE || 'http://localhost:3000'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026!'
const SHOTS = path.resolve('shots')
const W = 390 // iPhone 逻辑宽度，和 e2e 保持一致的手机视图
const H = 844
const MAX_FULL_H = 4200 // 超长页面截断，避免出几万像素的图

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
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

async function main() {
  if (!EDGE) {
    console.error('未找到 Edge/Chrome，无法截图')
    process.exitCode = 1
    return
  }
  fs.rmSync(SHOTS, { recursive: true, force: true })
  fs.mkdirSync(SHOTS, { recursive: true })

  const profile = path.resolve('.shots-profile')
  fs.rmSync(profile, { recursive: true, force: true })
  const browser = spawn(
    EDGE,
    [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank',
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
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2, mobile: true,
  })

  let n = 0
  const taken = []

  /**
   * 截当前页。
   * full=true 时按文档实际高度整页截（手机页面往往比一屏长，
   * 只截一屏会把统计页下半截、后台第四张图截掉）。
   */
  async function shot(slug, { full = true, note = '' } = {}) {
    n += 1
    const prefix = String(n).padStart(2, '0')
    let clip = { x: 0, y: 0, width: W, height: H, scale: 1 }
    if (full) {
      const metrics = await cdp.send('Page.getLayoutMetrics')
      const size = metrics.cssContentSize || metrics.contentSize
      const height = Math.min(Math.max(Math.ceil(size.height), H), MAX_FULL_H)
      clip = { x: 0, y: 0, width: W, height, scale: 1 }
    }
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip,
    })
    const file = `${prefix}-${slug}.png`
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(data, 'base64'))
    taken.push({ file, note })
    console.log(`  ${prefix}  ${slug}${note ? ` — ${note}` : ''}`)
  }

  const hash = () => cdp.evaluate('location.hash')

  async function go(h, wait = 1500) {
    await cdp.evaluate(`location.hash = ${JSON.stringify(h)}`)
    await sleep(wait)
    // 回到顶部再截，避免带着上次的滚动位置
    await cdp.evaluate('window.scrollTo(0, 0)')
    await sleep(250)
  }

  async function login(user, pwd) {
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
      [...document.querySelectorAll('button')].find(b => b.type === 'submit').click();
    })()`)
    await sleep(2200)
  }

  /** echarts 的 canvas 只认真实输入，合成 MouseEvent 不触发（zrender 监听 pointer 事件） */
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
   * 把图表里的 canvas 量到视口坐标，必要时滚动到中间。
   * 参数是一个 JS 表达式（不是选择器字符串）—— 后台四张图要用标题定位，
   * 那种定位没法写成 querySelector 的选择器。
   */
  async function canvasBox(selExpr) {
    await cdp.evaluate(`(() => {
      const el = ${selExpr};
      if (el) el.scrollIntoView({ block: 'center' });
    })()`)
    await sleep(700)
    return cdp.evaluate(`(() => {
      const host = ${selExpr};
      if (!host) return null;
      const c = host.querySelector('canvas') || host;
      const r = c.getBoundingClientRect();
      return r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
    })()`)
  }

  /** 逐个落点试着点柱状图，直到跳转发生 */
  async function clickBar(selExpr, expect) {
    const box = await canvasBox(selExpr)
    if (!box) return false
    for (const yr of [0.85, 0.9, 0.7, 0.95, 0.6]) {
      for (const xr of [0.94, 0.9, 0.86, 0.82, 0.7, 0.5, 0.3]) {
        const before = await hash()
        await mouseClick(box.left + box.width * xr, box.top + box.height * yr)
        await sleep(600)
        const now = await hash()
        if (now !== before) return expect ? now.includes(expect) : true
      }
    }
    return false
  }

  /** 逐行点横向条图，直到跳转发生 */
  async function clickLayerRow(selExpr) {
    const box = await canvasBox(selExpr)
    if (!box) return false
    const plotH = box.height - 14
    for (const row of [3, 2, 1, 0]) {
      for (const xr of [0.55, 0.35, 0.15]) {
        const before = await hash()
        await mouseClick(box.left + box.width * xr, box.top + 10 + plotH * ((row + 0.5) / 4))
        await sleep(700)
        if ((await hash()) !== before) return true
      }
    }
    return false
  }

  /** 找同标题的卡片（后台四张图要靠标题区分），返回一个可求值的表达式 */
  const cardByTitle = (title, sel) =>
    `(([...document.querySelectorAll('.dash .card')].find(c =>
        (c.querySelector('.money__title')?.innerText || '').trim() === ${JSON.stringify(title)}
      ))?.querySelector(${JSON.stringify(sel)}) ?? null)`

  /** 普通选择器 → 表达式 */
  const bySel = (sel) => `document.querySelector(${JSON.stringify(sel)})`

  try {
    console.log('\n【一】未登录页')
    await cdp.send('Page.navigate', { url: `${BASE}/#/login` })
    await sleep(2500)
    await shot('login', { full: false, note: '登录页' })
    await go('/register')
    await sleep(500)
    await shot('register', { full: false, note: '注册页' })

    console.log('\n【二】用户端（demo 登录）')
    await login('demo@qingji.local', DEMO_PASSWORD)
    await go('/home', 2200)
    await shot('home', { note: '首页：本月收支 + 近 12 个月趋势 + 支出 TOP3' })

    await go('/record/new', 2000)
    await shot('record-new', { full: false, note: '记一笔：大字号金额 + 分类九宫格' })

    await go('/records', 2000)
    await shot('records', { note: '账单页：按日期分组' })

    await go('/stats', 2200)
    await shot('stats', { note: '统计页：环形图 + 每日柱状图 + 最大单笔' })

    await go('/categories', 2000)
    await shot('categories', { note: '分类管理' })

    await go('/budget', 2000)
    await shot('budget', { full: false, note: '月度预算' })

    await go('/mine', 1800)
    await shot('mine', { full: false, note: '我的' })

    console.log('\n【三】图表点击下钻的落点')
    // 首页趋势柱 → 该月账单
    await go('/home', 2200)
    if (await clickBar(bySel('.trend .trend-chart__canvas'), '/records?month=')) {
      await sleep(1800)
      await cdp.evaluate('window.scrollTo(0, 0)')
      await shot('drill-home-trend-to-records', { note: '点首页趋势柱 → 该月账单（表头只统计该月）' })
    } else {
      console.log('  !! 首页趋势柱点击未跳转')
    }

    // 首页 TOP3 分类行 → 该分类账单
    await go('/home', 2200)
    const topClicked = await cdp.evaluate(`(() => {
      const el = document.querySelectorAll('.top-item')[0];
      if (!el) return false;
      el.click();
      return true;
    })()`)
    if (topClicked) {
      await sleep(1800)
      await cdp.evaluate('window.scrollTo(0, 0)')
      await shot('drill-home-top-to-records', { note: '点首页「花得最多的」某行 → 该分类账单' })
    }

    // 统计页环形图扇区 → 该分类账单
    await go('/stats', 2400)
    await cdp.evaluate(`(() => {
      const ring = document.querySelector('.pie__ring');
      if (!ring) return;
      const rows = [...document.querySelectorAll('.pie__legend .legend')];
      const pct = Number((rows[0]?.querySelector('.legend__pct')?.innerText || '0').replace('%',''));
      const r = ring.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const radius = r.width / 2 - 11;
      const a = ((pct / 2) - 90) * Math.PI / 180;
      ring.dispatchEvent(new MouseEvent('click', {
        bubbles: true, view: window,
        clientX: cx + radius * Math.cos(a),
        clientY: cy + radius * Math.sin(a),
      }));
    })()`)
    await sleep(1800)
    await cdp.evaluate('window.scrollTo(0, 0)')
    await shot('drill-stats-ring-to-records', { note: '点统计页环形图扇区 → 该分类账单' })

    // 统计页每日柱 → 当天账单（表头只统计这一天）
    await go('/stats', 2400)
    const dayClicked = await cdp.evaluate(`(() => {
      const bars = [...document.querySelectorAll('.daily__chart .daily__bar')];
      const i = bars.findIndex(b => !b.disabled && Number(b.style.height.replace('%','')) > 10);
      if (i < 0) return false;
      bars[i].click();
      return true;
    })()`)
    if (dayClicked) {
      await sleep(1800)
      await cdp.evaluate('window.scrollTo(0, 0)')
      await shot('drill-stats-day-to-records', { note: '点统计页每日柱 → 当天账单（表头写明「仅统计 X月X日」）' })
    }

    console.log('\n【四】管理员后台（admin 登录）')
    await login('admin@qingji.local', ADMIN_PASSWORD)
    await go('/admin/dashboard', 2800)
    await shot('admin-dashboard', { note: '后台总览：新增用户 / 记账活跃度 / 全站收支趋势 / 用户活跃分层 / 记账排行榜' })

    await go('/admin/users', 2200)
    await shot('admin-users', { note: '后台用户管理' })

    console.log('\n【五】后台图表下钻的落点')
    const adminDrills = [
      { title: '新增用户', sel: '.trend-chart__canvas', kind: 'bar', slug: 'drill-admin-growth', note: '点「新增用户」柱 → 该月注册的用户' },
      { title: '记账活跃度', sel: '.trend-chart__canvas', kind: 'bar', slug: 'drill-admin-activity', note: '点「记账活跃度」柱 → 该月有记账的用户' },
      { title: '全站收支趋势', sel: '.trend-chart__canvas', kind: 'bar', slug: 'drill-admin-trend', note: '点「全站收支趋势」柱 → 该月活跃用户' },
      { title: '用户活跃分层', sel: '.layer-chart__canvas', kind: 'layer', slug: 'drill-admin-layers', note: '点「用户活跃分层」某档 → 该档位的用户（可清除筛选条）' },
    ]
    for (const d of adminDrills) {
      await go('/admin/dashboard', 2600)
      const sel = cardByTitle(d.title, d.sel)
      const ok = d.kind === 'bar' ? await clickBar(sel, '/admin/users?') : await clickLayerRow(sel)
      if (ok) {
        await sleep(1800)
        await cdp.evaluate('window.scrollTo(0, 0)')
        await shot(d.slug, { note: d.note })
      } else {
        console.log(`  !! 「${d.title}」点击未跳转`)
      }
    }
    // 后台用户列表滚动一屏，展示列表本身
    await go('/admin/users', 2200)
    await cdp.evaluate('window.scrollTo(0, 320)')
    await sleep(500)
    await shot('admin-users-list', { full: false, note: '后台用户列表：状态 / 笔数 / 累计支出' })

    console.log(`\n共生成 ${taken.length} 张截图 → ${SHOTS}`)
  } catch (err) {
    console.error('\n截图过程中断：', err.message)
    process.exitCode = 1
  } finally {
    browser.kill()
    await sleep(1200)
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      /* 残留 profile 不影响截图 */
    }
  }
}

main()
