/**
 * 占位模块。
 *
 * 插件侧的 app-loader.ts 会 import 'virtual:xechat-app-source'，
 * 该模块由构建插件在插件 bundle 构建时注入真实产物；
 * 而在构建 Vue 应用本身时不需要这个导入，故用空模块短路。
 *
 * 需同时提供默认导出（源码字符串）与具名导出 `APP_CSS`，
 * 否则 esbuild 等严格打包器会报 "No matching export"。
 */
export default ''
export const APP_CSS = ''
