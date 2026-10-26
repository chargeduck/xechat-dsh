/**
 * 应用包导出契约测试（纯静态断言，不执行产物）。
 *
 * 回归目标：Vue 应用包必须能被「<script src=Blob> 注入」的方式取到模块。
 *
 * 真实故障（2026-10-22 实测）：
 *   插件报「xechat 应用包已加载，但未导出 mountXechat」。
 *   根因是 vite 的 IIFE 产物形如
 *     `var __XECHAT_DSH_APP__ = (function(){...})({});`
 *   顶层 var 是**脚本作用域**绑定，通过 Blob URL 注入时不成为 window 属性，
 *   加载器读 window.__XECHAT_DSH_APP__ 得到 undefined。
 *   修复：vite 配置 output.footer 显式 `window.__XECHAT_DSH_APP__ = __XECHAT_DSH_APP__;`
 *
 * 这里只做静态断言，因为执行 Element Plus 需要真实 DOM，
 * Node 桩环境无法可靠模拟（试过，会在内部 DOM API 上报错）。
 *
 * 用法: node --experimental-strip-types --test tests/app-bundle.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP = path.join(ROOT, 'lib/xechat-app.js')
const CLIENT = path.join(ROOT, 'lib/client.js')

test('应用包产物存在且非空', () => {
  assert.ok(fs.existsSync(APP), `缺少 ${APP}，请先执行 npm run build:vite`)
  assert.ok(fs.statSync(APP).size > 100_000, '产物体积异常偏小')
})

test('产物显式把模块挂到 window（Blob 注入的前提）', () => {
  const src = fs.readFileSync(APP, 'utf-8')
  assert.match(
    src,
    /window\.__XECHAT_DSH_APP__\s*=\s*__XECHAT_DSH_APP__/,
    '缺少 window 挂载语句：顶层 var 不会成为 window 属性，Blob 注入后加载器读不到模块',
  )
})

test('产物同时导出 mountXechat 与 initXechat', () => {
  const src = fs.readFileSync(APP, 'utf-8')
  assert.match(src, /exports\.mountXechat\s*=/, '未导出 mountXechat')
  assert.match(src, /exports\.initXechat\s*=/, '未导出 initXechat')
})

test('插件 bundle 内联的副本同样带 window 挂载', () => {
  assert.ok(fs.existsSync(CLIENT), `缺少 ${CLIENT}，请先执行 npm run build:plugin`)
  const src = fs.readFileSync(CLIENT, 'utf-8')
  assert.match(
    src,
    /window\.__XECHAT_DSH_APP__\s*=\s*__XECHAT_DSH_APP__/,
    '内联进 client.js 的应用包缺少 window 挂载语句',
  )
})

test('产物不含未替换的 process.env（否则浏览器首行即抛错）', () => {
  const src = fs.readFileSync(APP, 'utf-8')
  const hits = src.match(/process\.env/g) ?? []
  assert.equal(
    hits.length,
    0,
    `发现 ${hits.length} 处未替换的 process.env。lib 模式下 Vite 不会自动注入 ` +
      'NODE_ENV，必须在 vite.config.js 的 define 中显式替换，' +
      '否则产物执行首行抛 ReferenceError，IIFE 中断、footer 不执行、导出为 undefined',
  )
})

test('插件 bundle 内联的副本同样不含未替换的 process.env', () => {
  const src = fs.readFileSync(CLIENT, 'utf-8')
  assert.equal(
    (src.match(/process\.env/g) ?? []).length,
    0,
    'client.js 内含未替换的 process.env',
  )
})

test('插件 bundle 仍符合 __ModuleLoader__ 契约', () => {
  const src = fs.readFileSync(CLIENT, 'utf-8')
  assert.match(src.slice(0, 200), /window\.__ModuleLoader__\.load\(/, '缺少 __ModuleLoader__ 注册')
  assert.match(src, /id:\s*"xechat-dsh"/, '模块 id 与包名不一致')
  assert.match(src, /exports\.apply\s*=/, '未导出 apply')
  assert.match(src, /exports\.inject\s*=/, '未导出 inject')
})
