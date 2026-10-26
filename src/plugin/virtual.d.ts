/**
 * 虚拟模块的类型声明。
 * 由 tsdown.config.mjs 的虚拟模块插件在构建时提供真实内容。
 */
declare module 'virtual:xechat-app-source' {
  /** Vue 应用 IIFE 产物源码 */
  const source: string
  export default source
  /** Vue 应用样式表文本 */
  export const APP_CSS: string
}
