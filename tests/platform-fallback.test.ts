/**
 * 平台降级回归测试（Node 原生 test runner）。
 *
 * 背景：官方塘（-s 0）跑的是旧版服务端，Platform 枚举只有 IDEA / WEB / COMMAND。
 * DSH 固定上报 DSH，老服务端反序列化枚举失败，回一句「消息内容解析异常!」，
 * 连接看着通但永远登不进去。修复方式是静默把 platform 降级成 WEB 重发 LOGIN。
 *
 * 这里锁住"什么时候该降级"的边界，避免以后改动误伤正常登录。
 *
 * 用法: node --experimental-strip-types --test tests/platform-fallback.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldDowngradePlatform } from '../src/transport/transport-websocket.js'

const PARSE_ERROR = '消息内容解析异常!'

test('DSH 遇到解析异常且未登录成功 → 降级', () => {
  assert.equal(shouldDowngradePlatform({
    platform: 'DSH', text: PARSE_ERROR, acked: false, downgraded: false
  }), true)
})

test('老枚举已有的平台不降级（WEB / IDEA / COMMAND）', () => {
  for (const p of ['WEB', 'IDEA', 'COMMAND']) {
    assert.equal(shouldDowngradePlatform({
      platform: p, text: PARSE_ERROR, acked: false, downgraded: false
    }), false, p + ' 不该降级')
  }
})

test('已经收到业务帧（登录成功）后不再降级', () => {
  assert.equal(shouldDowngradePlatform({
    platform: 'DSH', text: PARSE_ERROR, acked: true, downgraded: false
  }), false)
})

test('同一个塘只降级一次，避免死循环', () => {
  assert.equal(shouldDowngradePlatform({
    platform: 'DSH', text: PARSE_ERROR, acked: false, downgraded: true
  }), false)
})

test('其它 SYSTEM 提示不触发降级', () => {
  for (const t of ['请尽快更新插件版本至v1.6.7-beta！', 'Body is null!', '连接已断开']) {
    assert.equal(shouldDowngradePlatform({
      platform: 'DSH', text: t, acked: false, downgraded: false
    }), false, t)
  }
})

test('缺少平台或文本时安全返回 false', () => {
  assert.equal(shouldDowngradePlatform({}), false)
  assert.equal(shouldDowngradePlatform({ platform: 'DSH' }), false)
  assert.equal(shouldDowngradePlatform({ text: PARSE_ERROR }), false)
  assert.equal(shouldDowngradePlatform(null), false)
})
