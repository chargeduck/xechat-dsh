/**
 * Cordis 插件契约的最小声明。
 *
 * DSH 通过 window.__ModuleLoader__.load 注入的 require 解析共享模块表，
 * @deepseek-ai/cordis 的类型包在开发期不一定可用，因此这里只声明
 * xechat-dsh 实际用到的少数几个成员，避免引入编译期硬依赖。
 */

/** 可释放资源。返回函数即自动纳入 ctx.effect 的回调契约。 */
export type Disposer = () => void

/** 插件上下文（仅声明本插件使用到的能力）。 */
export interface PluginContext {
  /**
   * 注册一个随插件卸载自动释放的副作用。
   * @param callback 挂载逻辑，可返回释放函数
   * @param label 用于诊断的标签
   */
  effect(callback: () => Disposer | void, label?: string): Disposer
  /** 记录一条诊断日志（DSH 会把 ctx 日志收敛到同一个通道） */
  logger?: (message: string) => void
}

/** 客户端插件模块形状：具名导出 apply / inject。 */
export interface ClientPluginModule {
  apply(ctx: PluginContext): void
  inject?: string[]
}
