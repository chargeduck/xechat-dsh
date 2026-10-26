import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ElementPlus from 'unplugin-element-plus/vite'
import path from 'path'

const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

/**
 * 业务应用（Vue + Element Plus）的独立构建。
 *
 * 产物 lib/xechat-app.js 是一段 IIFE，全局暴露 __XECHAT_DSH_APP__：
 *   { mountXechat(el), initXechat() }
 * 由插件 bundle 通过 Blob URL 注入执行，不与 DSH 的模块表产生耦合。
 *
 * 与 xechat-web 的差异：
 *  - 不再为 file:// 协议做 script 重排（DSH 走 http(s)，模块化加载无跨域问题）
 *  - 保留可读输出，便于在浏览器 DevTools 里调试
 *  - 只构建这一份产物，作为 statics 内联进插件
 */
export default defineConfig({
  plugins: [vue(), ElementPlus()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 插件侧代码不进入这个构建
      'virtual:xechat-app-source': path.resolve(__dirname, 'src/plugin/empty-module.js'),
    },
  },
  /**
   * lib 模式下 Vite **不会**自动替换 `process.env.NODE_ENV`
   * （普通应用构建才会）。Vue / Pinia / Element Plus 里有 269 处该引用，
   * 浏览器没有 `process`，产物一执行就抛 ReferenceError: process is not defined，
   * 导致 IIFE 中断、footer 不执行、window.__XECHAT_DSH_APP__ 为 undefined。
   * 这里显式替换为字面量，让生产分支被静态求值掉。
   */
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  // 不在此处 define __XECHAT_DSH_EMBEDDED__：该标记必须由插件壳在「脚本执行前」
  // 运行时写入（见 app-loader.ts），静态 define 会把判断恒等替换为 true。
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
  build: {
    outDir: 'lib',
    emptyOutDir: false,
    assetsInlineLimit: 0,
    minify: false,
    target: 'es2018',
    modulePreload: false,
    lib: {
      entry: path.resolve(__dirname, 'src/main.js'),
      name: '__XECHAT_DSH_APP__',
      formats: ['iife'],
      fileName: () => 'xechat-app.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'xechat-app.css'
          return 'assets/[name][extname]'
        },
        // IIFE 产物是 `var __XECHAT_DSH_APP__ = (...)()`。
        // 通过 Blob URL 注入时，var 只存在于脚本自身作用域，**不会成为 window 属性**，
        // 于是加载器读 window.__XECHAT_DSH_APP__ 必然拿到 undefined。
        // 因此显式补一句挂载，保证任何注入方式下都能从 window 取到模块。
        footer: 'window.__XECHAT_DSH_APP__ = __XECHAT_DSH_APP__;',
      },
    },
  },
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'https://dld.lesscoding.net',
        changeOrigin: true,
      },
    },
  },
})
