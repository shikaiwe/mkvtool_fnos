import { computed, ref } from 'vue'
import { darkTheme } from 'naive-ui'

const saved = localStorage.getItem('mkv.theme')
export const isDark = ref(saved === null ? true : saved === 'dark')

export function setTheme(dark: boolean) {
  isDark.value = dark
  localStorage.setItem('mkv.theme', dark ? 'dark' : 'light')
}

export function toggleTheme() {
  setTheme(!isDark.value)
}

export const naiveTheme = computed(() => (isDark.value ? darkTheme : null))
