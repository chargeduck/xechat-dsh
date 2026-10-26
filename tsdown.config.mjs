/**
 * 插件打包配置（tsdown）。
 *
 * 产物契约（与 DSH Web 客户端一致）：
 *  - lib/index.js  —— host half，ESM，Node 侧加载，空实现
 *  - lib/client.js —— client half，**CJS 闭包**，通过
 *    window.__ModuleLoader__.load({ id, factory }) 注册
 *
 * client.js 的 externals 只保留 Web shell 冻结模块表里提供的包
 * （react / react-dom / cordis / @deepseek-ai/*），其余全部内联。
 *
 * virtual:xechat-app-source 由下方虚拟模块插件注入：
 * 把 vite 产出的 lib/xechat-app.js（+ 同名 css）作为字符串嵌入，
 * 运行时再转 Blob URL 交给浏览器执行。
 */
import fs from 'node:fs'
import path from 'node:path'

const id = 'xechat-dsh'

/**
 * Web shell 通过注入的 require 提供的模块。
 *
 * 依据 DSH Desktop 0.2.1-rc.2 的 app.asar 实测确认：
 * `require("react")` / `require("react-dom")` / `require("react-dom/client")`
 * / `require("react/jsx-runtime")` / `require("@deepseek-ai/cordis")`
 * 均在冻结模块表中可用。
 *
 * 注意：`@deepseek-ai/dsh-client-runtime/client` 与
 * `@deepseek-ai/dsh-client-web-react` 在该版本中**不存在**，不可列为 external，
 * 否则运行时会因 require 失败而整包挂掉。
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const APP_JS = path.resolve('lib/xechat-app.js')
const APP_CSS = path.resolve('lib/xechat-app.css')

/** 读取 vite 产物并生成注入字符串（缺失时抛错，避免产出空壳包） */
function readAppSource() {
  if (!fs.existsSync(APP_JS)) {
    throw new Error(
      `缺少 ${APP_JS}：请先执行 \`npm run build:vite\` 生成 Vue 应用产物，再打包插件。`,
    )
  }
  const js = fs.readFileSync(APP_JS, 'utf-8')
  const css = fs.existsSync(APP_CSS) ? fs.readFileSync(APP_CSS, 'utf-8') : ''
  return { js, css }
}

/** 虚拟模块插件：把应用产物 + 样式以字符串常量形式交给 bundle */
function xechatAppSource() {
  const VIRTUAL_ID = 'virtual:xechat-app-source'
  const RESOLVED = '\0' + VIRTUAL_ID
  let payload = null

  return {
    name: 'xechat-app-source',
    resolveId(source) {
      if (source === VIRTUAL_ID) return RESOLVED
      return null
    },
    load(moduleId) {
      if (moduleId !== RESOLVED) return null
      if (!payload) payload = readAppSource()
      // 样式以独立导出给出，供 loader 注入 <style>
      return [
        `export const APP_CSS = ${JSON.stringify(payload.css)};`,
        `export default ${JSON.stringify(payload.js)};`,
      ].join('\n')
    },
  }
}

export default [
  // host half：ESM，Node 侧
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // client half：CJS 闭包 + __ModuleLoader__ 注册
  {
    entry: { client: 'src/plugin/client.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    dts: false,
    sourcemap: true,
    clean: false,
    external: CLIENT_EXTERNALS,
    plugins: [xechatAppSource()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
