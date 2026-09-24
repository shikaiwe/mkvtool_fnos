import { ref } from 'vue'
import { darkTheme } from 'naive-ui'

const saved = localStorage.getItem('mkv.theme')
export const isDark = ref(saved === null ? true : saved === 'dark')

export function toggleTheme() {
  isDark.value = !isDark.value
  localStorage.setItem('mkv.theme', isDark.value ? 'dark' : 'light')
}

export const naiveTheme = () => (isDark.value ? darkTheme : null)
