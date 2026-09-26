import { computed, ref } from 'vue'
import { darkTheme } from 'naive-ui'

const saved = localStorage.getItem('mkv.theme')
export const isDark = ref(saved === 'dark') // 默认亮色，仅显式保存过 dark 才进深色

export function setTheme(dark: boolean) {
  isDark.value = dark
  localStorage.setItem('mkv.theme', dark ? 'dark' : 'light')
}

export function toggleTheme() {
  setTheme(!isDark.value)
}

export const naiveTheme = computed(() => (isDark.value ? darkTheme : null))
