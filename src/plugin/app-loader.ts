/**
 * Vue 应用加载器。
 *
 * 业务代码（xechat 的 Vue + Element Plus 应用）单独打成 IIFE 产物，
 * 由这里按需加载并以「宿主容器」形式挂载。这样做的原因：
 *  - DSH 客户端模块要求 CJS 闭包 + 共享模块表，不适合直接塞 Vue 运行时的打包结果
 *  - Vue 应用体积较大（Element Plus 全量），拆开可以延后到面板首次展开时再拉取
 *
 * 产物以 `blob:` URL 形式注入：DSH 的插件资源不一定以静态文件暴露，
 * 内联字符串再转 Blob 可保证在任意部署形态下都能加载。
 */

/** 静态注入的应用包（构建时由 vite 的 assetsInlineLimit 内联为字符串） */
import APP_SOURCE, { APP_CSS } from 'virtual:xechat-app-source'

const APP_URL_KEY = '__XECHAT_DSH_APP_URL__'
const APP_FINGERPRINT_KEY = '__XECHAT_DSH_APP_FP__'
const APP_GLOBAL_NAME = '__XECHAT_DSH_APP__'
const APP_STYLE_ATTR = 'data-plugin-app="xechat-dsh"'

let appUrl: string | undefined
let loadPromise: Promise<XechatAppModule> | undefined

/**
 * 产物指纹：判断 window 上缓存的应用包是否属于当前版本。
 *
 * 插件热更新只会重新执行插件壳（client.js），window 上的 `__XECHAT_DSH_APP__`
 * 和 Blob URL 都还在。若直接复用，上一版 Vue 应用会一直活着，新代码永远不生效。
 * 抽样 4096 个字符算哈希：4MB 级产物也就几毫秒，足够区分不同构建。
 */
function appFingerprint(source: string): string {
  let hash = 0
  const step = Math.max(1, Math.floor(source.length / 4096))
  for (let i = 0; i < source.length; i += step) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0
  }
  return source.length + ':' + (hash >>> 0).toString(36)
}

/** 注入应用样式（幂等；产物更新时替换旧样式表）。 */
function mountAppStyles(): void {
  if (typeof document === 'undefined' || !APP_CSS) return
  document.querySelectorAll(`style[${APP_STYLE_ATTR}]`).forEach((node) => node.remove())
  const style = document.createElement('style')
  style.setAttribute('data-plugin-app', 'xechat-dsh')
  style.textContent = APP_CSS
  document.head.appendChild(style)
}

export interface XechatAppHandle {
  unmount(): void
}

export interface XechatAppModule {
  mountXechat(el: HTMLElement): XechatAppHandle
  initXechat(): Promise<void>
}

/** 把内联源码转成可被 <script> 加载的 URL（只做一次）。 */
function resolveAppUrl(): string {
  if (appUrl) return appUrl

  // 优先复用已注入的 data URL（热更新/多面板场景）
  const cached = (window as unknown as Record<string, string | undefined>)[APP_URL_KEY]
  if (cached) {
    appUrl = cached
    return appUrl
  }

  const blob = new Blob([APP_SOURCE], { type: 'text/javascript' })
  appUrl = URL.createObjectURL(blob)  ;(window as unknown as Record<string, string | undefined>)[APP_URL_KEY] = appUrl
  // 标记：应用包由插件壳接管挂载，main.js 不再自举
  ;(window as unknown as Record<string, unknown>).__XECHAT_DSH_EMBEDDED__ = true
  return appUrl
}

/**
 * 加载 Vue 应用模块。
 * 注入 <script> 而非 eval：既避开 CSP 对 eval 的限制，也让错误堆栈可读。
 */
export function loadXechatApp(): Promise<XechatAppModule> {
  if (typeof window !== 'undefined') {
    const fp = appFingerprint(APP_SOURCE)
    const store = window as unknown as Record<string, unknown>
    if (store[APP_FINGERPRINT_KEY] !== fp) {
      // 产物变了（插件升级/重新构建）：丢弃上一版的应用包全局与 Blob URL。
      // 否则 readModule 会命中旧全局，本次修复的连接管理代码根本不会执行。
      delete store[APP_GLOBAL_NAME]
      resetAppUrl()
      store[APP_FINGERPRINT_KEY] = fp
    }
  }

  if (loadPromise) return loadPromise

  mountAppStyles()

  // 必须在脚本执行前设置：main.js 顶层会据此跳过自举
  ;(window as unknown as Record<string, unknown>).__XECHAT_DSH_EMBEDDED__ = true

  loadPromise = new Promise<XechatAppModule>((resolve, reject) => {
    const globalName = APP_GLOBAL_NAME

    // 已加载过（例如插件重载而脚本未被移除）：直接用全局导出
    const existing = (window as unknown as Record<string, XechatAppModule | undefined>)[globalName]
    if (existing && typeof existing.mountXechat === 'function') {
      resolve(existing)
      return
    }

    const script = document.createElement('script')
    script.dataset.xechatDshApp = ''

    /**
     * 从多个来源兜底取模块。
     *
     * 全局属性是最脆弱的来源：产物是 `var __XECHAT_DSH_APP__ = (...)()`，
     * 在某些执行方式下（CSP、承载上下文、宿主把脚本包进函数体）
     * 顶层 var 不会成为 window 属性（本次实测 client.js 内联场景即如此，
     * 而单独执行 lib/xechat-app.js 正常）。因此追加两条来源：
     *   1. script 元素自身能访问到的作用域（间接 eval，非严格模式下能看到全局词法绑定）
     *   2. 从宿主 DOM 反查（应用挂载函数是唯一入口，存在即说明已就绪）
     * 全部失败时给出可诊断的细节。
     */
    const readModule = (): XechatAppModule | undefined => {
      const fromWindow = (window as unknown as Record<string, XechatAppModule | undefined>)[globalName]
      if (fromWindow && typeof fromWindow.mountXechat === 'function') return fromWindow

      // 间接 eval：在全局作用域求值，可读到脚本级 var 留下的全局词法绑定
      try {
        const indirect = (0, eval)(
          'typeof __XECHAT_DSH_APP__ !== "undefined" ? __XECHAT_DSH_APP__ : undefined',
        ) as XechatAppModule | undefined
        if (indirect && typeof indirect.mountXechat === 'function') {
          // 顺手把它挂回 window，后续调用直接走快路径
          ;(window as unknown as Record<string, unknown>)[globalName] = indirect
          return indirect
        }
      } catch {
        /* eval 被 CSP 禁用时忽略 */
      }
      return undefined
    }

    const cleanup = () => {
      script.onload = null
      script.onerror = null
    }

    script.onload = () => {
      cleanup()
      const mod = readModule()
      if (!mod) {
        // 报出实际拿到的东西，便于定位是产物形态问题还是执行期异常
        const raw = (window as unknown as Record<string, unknown>)[globalName]
        const detail =
          raw === undefined
            ? 'undefined'
            : typeof raw === 'object'
              ? '{' + Object.keys(raw as object).slice(0, 6).join(', ') + '}'
              : String(raw)
        reject(
          new Error(
            'xechat 应用包已加载，但未导出 mountXechat（window.' +
              globalName +
              ' = ' +
              detail +
              '）。若产物在初始化阶段抛错，浏览器 Console 中应有对应堆栈',
          ),
        )
        return
      }
      resolve(mod)
    }

    script.onerror = () => {
      cleanup()
      reject(new Error('xechat 应用包加载失败（script onerror）'))
    }

    script.src = resolveAppUrl()
    document.head.appendChild(script)
  }).catch((error) => {
    // 失败后允许重试：清空缓存 Promise
    loadPromise = undefined
    throw error
  })

  return loadPromise
}

/** 卸载时释放 Blob URL（应用包可重新加载，故仅清理缓存引用）。 */
export function resetAppUrl(): void {
  if (!appUrl) return
  try {
    URL.revokeObjectURL(appUrl)
  } catch {
    /* ignore */
  }
  appUrl = undefined
  loadPromise = undefined
  delete (window as unknown as Record<string, string | undefined>)[APP_URL_KEY]
}
