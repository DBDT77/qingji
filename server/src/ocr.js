/**
 * 本地小票 OCR（tesseract.js）。
 *
 * - 完全在本机运行，不上传图片
 * - worker 单例 + 串行队列：Tesseract 一个实例同时只能处理一张图，
 *   并发请求排队即可，避免每次请求都重新初始化（初始化要几秒）
 * - 语言包首次使用时下载并缓存到 server/data/tessdata/，
 *   之后离线可用；缓存在 data/ 下，已在 .gitignore 里
 * - 下载源默认用 projectnaptha 静态镜像（tesseract.js 自带的 jsdelivr
 *   在国内常被重置），可用 OCR_LANG_PATH 换成其他镜像或本地目录
 */
import fs from 'node:fs'
import path from 'node:path'
import { createWorker } from 'tesseract.js'
import { ocrConfig } from './config.js'
import { DATA_DIR } from './db.js'
import { ApiError } from './utils.js'

const CACHE_DIR = path.join(DATA_DIR, 'tessdata')

let workerPromise = null
let queue = Promise.resolve()

async function getWorker() {
  if (!workerPromise) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    const { langPath } = ocrConfig()
    workerPromise = createWorker(['chi_sim', 'eng'], 1, {
      cachePath: CACHE_DIR,
      langPath,
      errorHandler: (err) => console.error('[ocr] worker 异常：', err?.message || err),
    }).catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i)
  if (!match) throw new ApiError('图片格式不正确', 400, 'BAD_IMAGE')
  const buffer = Buffer.from(match[1], 'base64')
  if (!buffer.length) throw new ApiError('图片内容为空', 400, 'BAD_IMAGE')
  if (buffer.length > 900_000) throw new ApiError('图片太大，请压缩后再试', 400, 'BAD_IMAGE')
  return buffer
}

/**
 * 识别一张 data URL 图片。
 * @returns {Promise<{ text: string, confidence: number }>}
 */
export function recognizeReceiptImage(dataUrl) {
  const buffer = decodeDataUrl(dataUrl)

  const run = queue.then(async () => {
    let worker = null
    try {
      worker = await getWorker()
      const { data } = await worker.recognize(buffer)
      return {
        text: String(data?.text || ''),
        confidence: Number(data?.confidence) || 0,
      }
    } catch (err) {
      // worker 崩溃后下次请求重新创建，否则会一直拿到坏实例
      if (worker) {
        await worker.terminate().catch(() => {})
        workerPromise = null
      }
      throw err
    }
  })

  // 队列本身不能因为一次失败而中断
  queue = run.catch(() => {})
  return run
}
