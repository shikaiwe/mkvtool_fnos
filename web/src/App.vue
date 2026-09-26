<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NConfigProvider, NGlobalStyle, NLayout, NLayoutSider, NLayoutContent, NLayoutHeader, NMenu, NSwitch, NIcon, NMessageProvider, NDialogProvider, zhCN, dateZhCN, enUS, dateEnUS } from 'naive-ui'
import { isDark, naiveTheme, setTheme } from './theme'
import { i18n, setLocale } from './i18n'

const route = useRoute()
const router = useRouter()

const menuOptions = computed(() => [
  { label: i18n.global.t('menu.jobs'), key: '/jobs' },
  { label: i18n.global.t('menu.muxer'), key: '/muxer' },
  { label: i18n.global.t('menu.extract'), key: '/extract' },
  { label: i18n.global.t('menu.propedit'), key: '/propedit' },
  { label: i18n.global.t('menu.info'), key: '/info' },
  { label: i18n.global.t('menu.chapters'), key: '/chapters' },
  { label: i18n.global.t('menu.settings'), key: '/settings' },
  { label: i18n.global.t('menu.about'), key: '/about' },
])

const activeKey = computed(() => (route.path as string) || '/jobs')
const isZh = computed(() => i18n.global.locale.value === 'zh-CN')

function onMenuUpdate(key: string) {
  router.push(key)
}
</script>

<template>
  <NConfigProvider
    :theme="naiveTheme"
    :locale="isZh ? zhCN : enUS"
    :date-locale="isZh ? dateZhCN : dateEnUS"
    style="height: 100vh"
  >
    <NGlobalStyle />
    <NLayout position="absolute">
      <NLayoutHeader bordered style="height: 52px; display: flex; align-items: center; padding: 0 20px; gap: 12px">
        <span style="font-weight: 700; font-size: 16px">MKVToolNix</span>
        <span style="opacity: 0.55; font-size: 12px">for fnOS</span>
        <div style="flex: 1" />
        <span style="font-size: 12px; opacity: 0.6">EN / 中</span>
        <NSwitch size="small" :value="isZh" @update:value="(v: boolean) => setLocale(v ? 'zh-CN' : 'en-US')" />
        <span style="font-size: 12px; opacity: 0.6; margin-left: 8px">🌙</span>
        <NSwitch size="small" :value="isDark" @update:value="(v: boolean) => setTheme(v)" />
      </NLayoutHeader>
      <NLayout has-sider position="absolute" style="top: 52px">
        <NLayoutSider bordered :width="180" :collapsed-width="0" collapse-mode="width" show-trigger="bar">
          <NMenu :options="menuOptions" :value="activeKey" @update:value="onMenuUpdate" />
        </NLayoutSider>
        <NLayoutContent content-style="padding: 20px; height: 100%; overflow: auto">
          <NMessageProvider>
            <NDialogProvider>
              <router-view />
            </NDialogProvider>
          </NMessageProvider>
        </NLayoutContent>
      </NLayout>
    </NLayout>
  </NConfigProvider>
</template>
