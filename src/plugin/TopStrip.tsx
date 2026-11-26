/**
 * 顶部状态条：把小说当前行显示在 DSH 窗口顶部（菜单栏右侧的空白区域）。
 *
 * 渲染在 `shell.overlay` 里，overlay 本身是 `inset:0` 的浮层，
 * 所以可以绝对定位到标题栏那一行——这层是纯展示：
 *   - pointer-events: none，不会挡住菜单、窗口拖拽和最小化/关闭按钮；
 *   - 没有文字时整块不渲染，不占位也不影响布局。
 *
 * 数据来自 Vue 应用广播的 `xechat:reader-line` 事件（同一个 document，事件共享）。
 */
import { createElement, useEffect, useState } from 'react'

interface LinePayload {
  text?: string
  book?: string
  percent?: number
}

export function TopStrip() {
  const [state, setState] = useState<LinePayload>({})

  useEffect(() => {
    const onLine = (e: Event) => {
      const d = (e as CustomEvent<LinePayload>).detail || {}
      setState({ text: d.text || '', book: d.book || '', percent: d.percent })
    }
    window.addEventListener('xechat:reader-line', onLine as EventListener)
    return () => window.removeEventListener('xechat:reader-line', onLine as EventListener)
  }, [])

  const text = (state.text || '').trim()
  if (!text) return null

  const title = [state.book, typeof state.percent === 'number' ? state.percent + '%' : '']
    .filter(Boolean)
    .join(' · ')

  return createElement(
    'div',
    { className: 'xds-topstrip', title },
    createElement('span', { className: 'xds-topstrip-text' }, text)
  )
}
