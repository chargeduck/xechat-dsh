import { useDark } from '@vueuse/core'

export const isDark = useDark({
  selector: 'html',
  attribute: 'class',
  valueDark: 'dark',
  valueLight: 'light',
  initialValue: 'dark',
  storageKey: 'xechat-theme'
})

// useToggle(useDark()) 在 VueUse 14.x 下切换受控 ref 不可靠，改手动赋值
export function toggleTheme() {
  isDark.value = !isDark.value
}
