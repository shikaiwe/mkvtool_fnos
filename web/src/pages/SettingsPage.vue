<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NSpace, NButton, NInput, NInputNumber, NSelect, NTag, NTable, useMessage } from 'naive-ui'
import { api, type Settings, type SystemInfo } from '../api'

const { t, locale } = useI18n()
const message = useMessage()

const concurrency = ref(2)
const binDir = ref('')
const defaultOutputDir = ref('')
const uiLanguage = ref('zh-CN')
const roots = ref<Settings['roots']>([])
const sys = ref<SystemInfo | null>(null)
const saving = ref(false)

async function load() {
  try {
    const [s, sysInfo] = await Promise.all([api.settings(), api.system()])
    concurrency.value = s.concurrency
    binDir.value = s.binDir
    defaultOutputDir.value = s.defaultOutputDir
    uiLanguage.value = s.uiLanguage
    roots.value = s.roots
    sys.value = sysInfo
  } catch (e: any) {
    message.error(e.message)
  }
}

async function save() {
  saving.value = true
  try {
    await api.saveSettings({
      concurrency: concurrency.value,
      binDir: binDir.value,
      defaultOutputDir: defaultOutputDir.value,
      uiLanguage: uiLanguage.value,
    })
    message.success(t('settings.saved'))
  } catch (e: any) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('settings.title')">
      <NSpace vertical size="small">
        <div style="display: flex; gap: 8px; align-items: center">
          <span style="width: 340px; font-size: 13px">{{ $t('settings.concurrency') }}</span>
          <NInputNumber v-model:value="concurrency" :min="1" :max="8" style="width: 120px" />
        </div>
        <div style="display: flex; gap: 8px; align-items: center">
          <span style="width: 340px; font-size: 13px">{{ $t('settings.binDir') }}</span>
          <NInput v-model:value="binDir" placeholder="/var/apps/mkvtoolnix/target/bin" style="width: 420px" />
        </div>
        <div style="display: flex; gap: 8px; align-items: center">
          <span style="width: 340px; font-size: 13px">{{ $t('settings.defaultOutputDir') }}</span>
          <NInput v-model:value="defaultOutputDir" placeholder="/vol1/..." style="width: 420px" />
        </div>
        <div style="display: flex; gap: 8px; align-items: center">
          <span style="width: 340px; font-size: 13px">{{ $t('settings.uiLanguage') }}</span>
          <NSelect
            v-model:value="uiLanguage"
            style="width: 160px"
            :options="[
              { label: '中文', value: 'zh-CN' },
              { label: 'English', value: 'en-US' },
            ]"
          />
        </div>
        <NButton type="primary" :loading="saving" @click="save" style="align-self: flex-start">
          {{ $t('common.save') }}
        </NButton>
      </NSpace>
    </NCard>

    <NCard :title="$t('settings.roots')">
      <NTable size="small" :single-line="false" :bordered="false">
        <tbody>
          <tr v-for="r in roots" :key="r.path">
            <td style="width: 160px"><NTag size="small" :bordered="false">{{ r.label }}</NTag></td>
            <td style="word-break: break-all">{{ r.path }}</td>
          </tr>
        </tbody>
      </NTable>
    </NCard>

    <NCard :title="$t('settings.tools')">
      <NSpace vertical size="small">
        <div v-if="sys">
          <b style="font-size: 13px">{{ $t('settings.mkvVersion') }}: </b>
          <span v-if="sys.mkv.version">{{ sys.mkv.version }}</span>
          <NTag v-else type="error" size="small">{{ sys.mkv.error }}</NTag>
        </div>
        <NAlert v-if="sys && !sys.mkv.version" type="warning" :show-icon="false">{{ $t('settings.mkvMissing') }}</NAlert>
        <NTable v-if="sys" size="small" :single-line="false" :bordered="false">
          <tbody>
            <tr v-for="(v, k) in sys.mkv.tools" :key="k">
              <td style="width: 140px">{{ k }}</td>
              <td style="word-break: break-all">{{ v.path }}（{{ v.source }}）</td>
            </tr>
          </tbody>
        </NTable>
      </NSpace>
    </NCard>
  </NSpace>
</template>
