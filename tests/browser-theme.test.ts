/**
 * 内置浏览器配色策略的单元测试。
 *
 * 这些是纯函数，不碰 DOM，因此可以完整覆盖边界：
 * 非法模式回落、降亮夹取、off 模式不着色、跨源探测失败不抛错。
 *
 * 用法: node --experimental-strip-types --test tests/browser-theme.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PALETTES,
  THEME_MODES,
  resolveTheme,
  clampDim,
  buildStageStyle,
  buildSameOriginCss,
  canInject,
} from '../src/composables/browserTheme.js'

test('auto 跟随当前深浅色', () => {
  assert.equal(resolveTheme('auto', true), 'dark')
  assert.equal(resolveTheme('auto', false), 'light')
})

test('显式模式不被当前主题覆盖', () => {
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('off', true), 'off')
})

test('未知模式按 auto 处理（存储损坏不应让面板崩掉）', () => {
  assert.equal(resolveTheme('nonsense', true), 'dark')
  assert.equal(resolveTheme(undefined, false), 'light')
  assert.equal(resolveTheme(null, true), 'dark')
})

test('THEME_MODES 与 resolveTheme 的取值域一致', () => {
  for (const mode of THEME_MODES) {
    const resolved = resolveTheme(mode, true)
    if (mode === 'auto') {
      // auto 不是终态：它必须跟随当前深浅色，而不是原样返回
      assert.equal(resolved, 'dark')
    } else {
      assert.equal(resolved, mode, `显式模式 ${mode} 不应被当前主题覆盖`)
    }
    // 无论如何，结果必须落在三个终态之一
    assert.ok(['dark', 'light', 'off'].includes(resolved), `resolveTheme('${mode}') 返回了非法终态`)
  }
})

test('降亮强度夹取到 0 ~ 0.6', () => {
  assert.equal(clampDim(-1), 0)
  assert.equal(clampDim(0), 0)
  assert.equal(clampDim(0.25), 0.25)
  assert.equal(clampDim(0.6), 0.6)
  // 超过上限必须被压住：再暗就看不清网页文字了
  assert.equal(clampDim(0.95), 0.6)
  assert.equal(clampDim(99), 0.6)
})

test('降亮的非法输入回落 0（而不是 NaN 渗进样式）', () => {
  // 注意：clampDim 对非数字返回 0，'0.3' 能被 Number 转换
  assert.equal(clampDim('abc'), 0)
  assert.equal(clampDim(undefined), 0)
  assert.equal(clampDim(NaN), 0)
  assert.equal(clampDim('0.3'), 0.3)
})

test('深色容器使用深色底与可见遮罩', () => {
  const s = buildStageStyle('dark', 0.25)
  assert.equal(s.surface, PALETTES.dark.surface)
  assert.equal(s.scrimOpacity, 0.25)
  assert.equal(s.colorScheme, 'dark')
})

test('浅色容器改用浅色底', () => {
  const s = buildStageStyle('light', 0.25)
  assert.equal(s.surface, PALETTES.light.surface)
  assert.equal(s.colorScheme, 'light')
})

test('off 模式不着色、不遮罩', () => {
  const s = buildStageStyle('off', 0.5)
  assert.equal(s.surface, '#ffffff', 'off 模式应保持浏览器默认白底')
  assert.equal(s.scrimOpacity, 0, 'off 模式下不应有遮罩')
  assert.equal(s.colorScheme, 'normal')
})

test('降亮为 0 时不生成遮罩层', () => {
  const s = buildStageStyle('dark', 0)
  assert.equal(s.scrimOpacity, 0)
})

test('同源注入样式声明 color-scheme 并铺底', () => {
  const css = buildSameOriginCss('dark')
  assert.match(css, /color-scheme:\s*dark/, '缺少 color-scheme，原生滚动条不会跟随深浅')
  assert.match(css, /background:\s*#1e1e1e/, '缺少铺底，仍会白闪')
})

test('off 模式不生成任何注入样式', () => {
  assert.equal(buildSameOriginCss('off'), '')
})

test('跨源 iframe 探测返回 false 而不抛错', () => {
  // 模拟跨源：访问 contentDocument 抛 SecurityError
  const crossOrigin = {
    get contentDocument() {
      throw new Error('SecurityError')
    },
    contentWindow: {},
  }
  assert.equal(canInject(crossOrigin), false)
  assert.equal(canInject(null), false)
  assert.equal(canInject(undefined), false)
  // 没有 contentDocument 的普通对象也不应通过
  assert.equal(canInject({}), false)
})

test('同源 iframe 探测通过', () => {
  const sameOrigin = { contentDocument: { head: {} }, contentWindow: {} }
  assert.equal(canInject(sameOrigin), true)
})

/**
 * 遮罩层的行为约束（回归保护）。
 *
 * 遮罩是覆盖在 iframe 之上的元素，一旦吃掉指针事件，
 * 页面内的点击、滚动、文本选择会全部失效——比白屏更糟。
 */
test('遮罩样式必须 pointer-events: none', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const vueSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/views/tools/BrowserPanel.vue'),
    'utf-8',
  )
  const rule = /\.browser-scrim\s*\{([^}]*)\}/.exec(vueSrc)
  assert.ok(rule, '未找到 .browser-scrim 样式规则')
  assert.match(rule[1], /pointer-events:\s*none/, '遮罩会挡住页面内点击与滚动')
  assert.match(rule[1], /position:\s*absolute/, '遮罩需要绝对定位覆盖在 iframe 之上')
})

test('容器底色不再写死白色', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const vueSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/views/tools/BrowserPanel.vue'),
    'utf-8',
  )
  const frameRule = /\.browser-frame\s*\{([^}]*)\}/.exec(vueSrc)
  assert.ok(frameRule, '未找到 .browser-frame 样式规则')
  assert.doesNotMatch(
    frameRule[1],
    /background:\s*#fff\b/i,
    'iframe 仍写死白色底：深色主题下页面加载时会整块白闪',
  )
})
