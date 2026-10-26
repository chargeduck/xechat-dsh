/**
 * 依赖补齐脚本（一次性使用）。
 *
 * 背景：本项目直接从 xechat-web 复制 node_modules 以节省时间，
 * 但复制过程被中断导致部分包缺失。此脚本对比源/目标目录，
 * 只补缺失项，不覆盖已有内容。
 *
 * 用法: node scripts/sync-deps.mjs <源 node_modules> [目标 node_modules]
 */
import fs from 'node:fs'
import path from 'node:path'

const src = process.argv[2]
const dest = process.argv[3] || path.resolve('node_modules')

if (!src || !fs.existsSync(src)) {
  console.error('[sync-deps] 源目录不存在:', src)
  process.exit(1)
}

let copied = 0
const missing = []

function syncDir(a, b) {
  for (const entry of fs.readdirSync(a, { withFileTypes: true })) {
    const sa = path.join(a, entry.name)
    const db = path.join(b, entry.name)
    if (!fs.existsSync(db)) {
      fs.cpSync(sa, db, { recursive: true })
      copied++
      console.log('[sync-deps] +', path.relative(dest, db))
      continue
    }
    // 作用域目录递归，其余包只检查自身顶层内容
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      syncDir(sa, db)
    }
  }
}

syncDir(src, dest)
console.log(`[sync-deps] done, copied=${copied}`)
if (missing.length) console.log('[sync-deps] 缺失:', missing.join(', '))
