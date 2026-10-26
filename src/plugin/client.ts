/**
 * 客户端插件入口（client half）。
 *
 * 遵循 DSH 官方插件规范：
 *  - 不 append 到 document.body，不替换应用根节点
 *  - 通过 `ctx.slots.inject(ownerKey, cb)` + `ctx.slots.register(...)` 贡献 UI
 *  - 资源全部登记在 `apply` 内的 ctx.effect 中，随插件卸载自动回收
 *
 * 挂载点选 `shell.overlay`：官方规范对它的定位是
 * “需要覆盖层、且位置已确定时使用”，本插件的悬浮 Dock 正属此类。
 */
import type { PluginContext } from './contract.ts'
import { DockShell } from './DockShell.tsx'

/**
 * DSH 客户端 slot 服务（仅声明用到的部分）。
 * 官方签名：
 *   ctx.slots.inject(ownerKey, () => ctx.slots.register(target, component))
 */
export interface SlotsService {
  inject(ownerKey: string, callback: () => unknown): unknown
  register(target: { name: string; id: string; order?: number }, component: unknown): unknown
}

/** 扩展上下文：客户端额外注入的 slots 服务 */
export interface ClientPluginContext extends PluginContext {
  slots?: SlotsService
}

/** 依赖 slots 服务就绪后再激活 */
export const inject: string[] = ['slots']

/** 目标 slot：宿主 shell 提供的覆盖层 */
const OVERLAY_SLOT = 'shell.overlay'

/** 本插件在 slot 中的条目 id，需全局唯一 */
const ENTRY_ID = 'xechat-dsh'

export function apply(ctx: ClientPluginContext): void {
  const slots = ctx.slots
  if (!slots) {
    // 缺服务要「响亮地失败」，而不是静默不渲染
    console.error('[xechat-dsh] 缺少 slots 服务，插件未激活')
    return
  }

  ctx.effect(
    () =>
      slots.inject(OVERLAY_SLOT, () =>
        slots.register({ name: OVERLAY_SLOT, id: ENTRY_ID, order: 100 }, DockShell),
      ),
    'xechat-dsh: overlay entry',
  )
}
