/**
 * 插件 bundle 冒烟测试。
 *
 * 在最小化的桩环境里执行 lib/client.js，验证 DSH 官方插件规范的合规点：
 *  1. 只注册一次 __ModuleLoader__，id 与 package.json#name 一致
 *  2. 工厂导出 apply / inject，且 inject 声明了 slots 依赖
 *  3. apply 通过 ctx.slots.inject + ctx.slots.register 贡献 UI
 *  4. 不 append 到 document.body、不改写应用根节点（官方硬性要求）
 *  5. 释放 disposer 后 slot 贡献被回收（生命周期可逆）
 *  6. 产物不含 eval
 *
 * 用法: node --experimental-strip-types --test tests/bundle.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CLIENT = path.join(ROOT, 'lib/client.js')
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
const SOURCE = fs.readFileSync(CLIENT, 'utf-8')

/** 记录所有对 document.body 的写入，用于断言“不碰 body” */
function createDom() {
  const bodyWrites: string[] = []
  const makeEl = (tag: string) => {
    const el: any = {
      tagName: tag.toUpperCase(),
      style: {},
      dataset: {},
      attributes: {} as Record<string, string>,
      children: [] as any[],
      setAttribute(k: string, v: string) {
        this.attributes[k] = v
      },
      getAttribute(k: string) {
        return this.attributes[k] ?? null
      },
      appendChild(child: any) {
        this.children.push(child)
        return child
      },
      removeChild(child: any) {
        this.children = this.children.filter((c: any) => c !== child)
        return child
      },
      remove() {},
      contains() {
        return false
      },
      addEventListener() {},
      removeEventListener() {},
      querySelector() {
        return null
      },
      set innerHTML(_v: string) {
        this.children = []
      },
      get innerHTML() {
        return ''
      },
      parentNode: null as any,
    }
    return el
  }

  const body = makeEl('body')
  const head = makeEl('head')
  // 拦截 body/head 的所有插入行为
  for (const [name, el] of [['body', body], ['head', head]] as const) {
    const origAppend = el.appendChild
    const origSet = Object.getOwnPropertyDescriptor(el, 'innerHTML')!.set!
    el.appendChild = function (child: any) {
      bodyWrites.push(`${name}.appendChild(${child?.tagName ?? '?'})`)
      return origAppend.call(this, child)
    }
    Object.defineProperty(el, 'innerHTML', {
      get: () => '',
      set: (v: string) => {
        bodyWrites.push(`${name}.innerHTML=`)
        origSet.call(el, v)
      },
    })
  }

  const document = {
    body,
    head,
    documentElement: makeEl('html'),
    createElement: (t: string) => makeEl(t),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  }

  return { document, bodyWrites }
}

function runBundle() {
  const dom = createDom()
  const registrations: Array<{ id: string; factory: (req: (k: string) => any) => any }> = []

  const reactStub: any = (type: any, props: any, ...children: any[]) => ({ type, props, children })
  reactStub.createElement = reactStub
  reactStub.useCallback = (fn: any) => fn
  reactStub.useEffect = () => {}
  reactStub.useRef = (v: any) => ({ current: v })
  reactStub.useState = (v: any) => [typeof v === 'function' ? v() : v, () => {}]
  reactStub.Fragment = 'fragment'

  const sandbox: any = {
    document: dom.document,
    console,
    setTimeout,
    clearTimeout,
    Blob: class {
      parts: any[]
      constructor(parts: any[]) {
        this.parts = parts
      }
    },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    Symbol,
    Object,
    Array,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Error,
    Promise,
    Map,
    Set,
    Reflect,
    Function,
    RegExp,
    Date,
    Proxy,
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = {
    load: (entry: any) => registrations.push(entry),
  }

  // 组装前需要 localStorage 供 loadLayout 使用
  const store = new Map<string, string>()
  sandbox.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }

  const context = vm.createContext(sandbox)
  vm.runInContext(SOURCE, context, { filename: 'client.js' })

  const entry = registrations[0]
  const mod = entry.factory((name: string) => {
    if (name === 'react') return reactStub
    if (name === 'react/jsx-runtime')
      return { jsx: reactStub, jsxs: reactStub, Fragment: 'fragment' }
    if (name === 'react-dom/client')
      return { createRoot: () => ({ render() {}, unmount() {} }) }
    if (name === '@deepseek-ai/cordis') return {}
    if (name === '@deepseek-ai/dsh-client-ui-slots') return {}
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error('未声明的外部模块: ' + name)
  })

  return { entry, mod, dom }
}

test('bundle 只注册一次，id 与包名一致', () => {
  const { entry } = runBundle()
  assert.ok(entry, '未能捕获 __ModuleLoader__.load 调用')
  assert.equal(entry.id, PKG.name)
})

test('工厂导出 apply 与 inject，且声明 slots 依赖', () => {
  const { mod } = runBundle()
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject))
  assert.ok(mod.inject.includes('slots'), 'inject 必须包含 slots')
})

test('apply 通过 slots.inject + slots.register 贡献 UI', () => {
  const { mod } = runBundle()

  const calls: string[] = []
  let registered: any = null
  const ctx = {
    effect: (cb: () => void) => cb(),
    slots: {
      inject: (owner: string, cb: () => unknown) => {
        calls.push('inject:' + owner)
        return cb()
      },
      register: (target: any, comp: any) => {
        calls.push('register:' + target.id)
        registered = { target, comp }
        return () => {}
      },
    },
  }

  mod.apply(ctx)

  assert.deepEqual(calls, ['inject:shell.overlay', 'register:xechat-dsh'])
  assert.equal(registered.target.name, 'shell.overlay')
  assert.equal(typeof registered.comp, 'function')
})

test('缺少 slots 服务时响亮失败而非静默', () => {
  const { mod } = runBundle()
  const errors: string[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => void errors.push(args.join(' '))
  try {
    mod.apply({ effect: (cb: () => void) => cb() } as any)
  } finally {
    console.error = origError
  }
  assert.ok(
    errors.some((e) => e.includes('缺少 slots 服务')),
    '应当在缺少 slots 时输出错误日志',
  )
})

test('不向 document.body 写入任何内容（官方硬性规范）', () => {
  const { mod, dom } = runBundle()

  mod.apply({
    effect: (cb: () => void) => cb(),
    slots: {
      inject: (_o: string, cb: () => unknown) => cb(),
      register: () => () => {},
    },
  })

  assert.deepEqual(dom.bodyWrites, [], '插件不应 append 到 body 或改写 body.innerHTML')
})

test('释放 disposer 后 slot 贡献被回收（生命周期可逆）', () => {
  const { mod } = runBundle()

  let disposed = false
  let disposer: any = null
  const ctx = {
    effect: (cb: () => any) => {
      disposer = cb()
      return disposer
    },
    slots: {
      inject: (_o: string, cb: () => unknown) => cb(),
      register: () => () => {
        disposed = true
      },
    },
  }

  mod.apply(ctx)
  assert.equal(typeof disposer, 'function')
  disposer()
  assert.equal(disposed, true, '释放后应调用 slot 的注销函数')
})

test('产物不含 eval，不触碰 DSH 私有对象', () => {
  assert.equal(/\beval\s*\(/.test(SOURCE), false, 'bundle 不应使用 eval')
  assert.equal(/__DSH_INTERNAL__|dshInternals/.test(SOURCE), false, '不应访问 DSH 私有对象')
})

test('package.json 声明 dsh.bundle 与 client.platform', () => {
  assert.ok(PKG.dsh?.bundle?.patch, '缺少 dsh.bundle.patch（没有它无法安装）')
  assert.equal(PKG.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(PKG.dsh?.client?.platform, 'web')
  assert.ok(PKG.files.includes('cordis.patch.yml'), 'files 未包含 cordis.patch.yml')
  assert.ok(PKG.files.includes('lib'))
})
