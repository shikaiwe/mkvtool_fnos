<script setup lang="ts">
// 章节编辑器：从 MKV 读取 / XML 导入 → 表格编辑 → 生成 XML → mkvpropedit 写回
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NInputNumber, NTag, NAlert, NTable, useMessage,
} from 'naive-ui'
import { api, type Edition } from '../api'
import FileBrowser from '../components/FileBrowser.vue'

const { t } = useI18n()
const message = useMessage()

const src = ref('')
const editions = ref<Edition[]>([])
const loading = ref(false)
const xmlInput = ref('')
const xmlPreview = ref('')
const tempFile = ref('')
const browser = ref(false)

const totalChapters = computed(() => editions.value.reduce((n, e) => n + e.chapters.length, 0))

async function loadFromFile() {
  if (!src.value) return
  loading.value = true
  try {
    const r = await api.chaptersFromFile(src.value)
    editions.value = r.editions.length ? r.editions : [{ name: '', chapters: [] }]
    message.success(t('chapters.loaded', { n: totalChapters.value }))
    if (!r.editions.length) message.info(t('chapters.noChapters'))
  } catch (e: any) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}

async function parseXml() {
  try {
    const r = await api.chaptersParse(xmlInput.value)
    editions.value = r.editions.length ? r.editions : [{ name: '', chapters: [] }]
    message.success(t('chapters.loaded', { n: totalChapters.value }))
  } catch (e: any) {
    message.error(e.message)
  }
}

function addChapter(ei: number) {
  const ed = editions.value[ei]
  const last = ed.chapters[ed.chapters.length - 1]
  ed.chapters.push({
    start: '',
    end: '',
    title: `Chapter ${ed.chapters.length + 1}`,
    language: 'und',
    startSec: last?.endSec ?? last?.startSec ?? 0,
    endSec: (last?.endSec ?? last?.startSec ?? 0) + 60,
  })
}

function removeChapter(ei: number, ci: number) {
  editions.value[ei].chapters.splice(ci, 1)
}

function moveChapter(ei: number, ci: number, dir: -1 | 1) {
  const arr = editions.value[ei].chapters
  const j = ci + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[ci], arr[j]] = [arr[j], arr[ci]]
}

async function genXml() {
  try {
    const r = await api.chaptersTemp(editions.value)
    tempFile.value = r.file
    xmlPreview.value = r.xml
  } catch (e: any) {
    message.error(e.message)
  }
}

async function applyToMkv() {
  if (!src.value || !tempFile.value) return
  try {
    await api.createJob({
      name: `chapters ${src.value.split(/[\\/]/).pop()}`,
      tool: 'mkvpropedit',
      argv: [src.value, '--chapters', tempFile.value],
    })
    message.success(t('chapters.applied'))
  } catch (e: any) {
    message.error(e.message)
  }
}

async function copyPath() {
  try {
    await navigator.clipboard.writeText(tempFile.value)
    message.success(t('common.copied'))
  } catch {
    message.warning(tempFile.value)
  }
}
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('chapters.title')">
      <NSpace vertical size="small">
        <NSpace>
          <NInput :value="src" readonly :placeholder="$t('chapters.needSource')" style="width: 420px" @click="browser = true">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="browser = true">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
          <NButton type="primary" :loading="loading" :disabled="!src" @click="loadFromFile">
            {{ $t('chapters.loadFromFile') }}
          </NButton>
        </NSpace>
        <NSpace align="start">
          <NInput
            v-model:value="xmlInput"
            type="textarea"
            :rows="3"
            :placeholder="$t('chapters.xmlInput')"
            style="width: 420px; font-family: monospace"
          />
          <NButton @click="parseXml">{{ $t('chapters.parse') }}</NButton>
        </NSpace>
      </NSpace>
    </NCard>

    <NCard v-for="(ed, ei) in editions" :key="ei" :title="`${$t('chapters.edition')} ${ei + 1}${ed.name ? ' — ' + ed.name : ''}`">
      <template #header-extra>
        <NButton size="small" @click="addChapter(ei)">{{ $t('chapters.addChapter') }}</NButton>
      </template>
      <NTable size="small" :single-line="false">
        <thead>
          <tr>
            <th style="width: 130px">{{ $t('chapters.start') }}</th>
            <th style="width: 130px">{{ $t('chapters.end') }}（{{ $t('chapters.endAuto') }}）</th>
            <th>{{ $t('chapters.title') }}</th>
            <th style="width: 90px">{{ $t('chapters.lang') }}</th>
            <th style="width: 120px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(ch, ci) in ed.chapters" :key="ci">
            <td>
              <NInputNumber
                :value="ch.startSec"
                size="tiny"
                :show-button="false"
                :min="0"
                :step="1"
                placeholder="秒"
                @update:value="(v: number | null) => (ch.startSec = v)"
              />
            </td>
            <td>
              <NInputNumber
                :value="ch.endSec"
                size="tiny"
                :show-button="false"
                :min="0"
                :step="1"
                placeholder="秒"
                @update:value="(v: number | null) => (ch.endSec = v)"
              />
            </td>
            <td><NInput v-model:value="ch.title" size="tiny" /></td>
            <td><NInput v-model:value="ch.language" size="tiny" /></td>
            <td>
              <NButton size="tiny" quaternary @click="moveChapter(ei, ci, -1)">↑</NButton>
              <NButton size="tiny" quaternary @click="moveChapter(ei, ci, 1)">↓</NButton>
              <NButton size="tiny" quaternary type="error" @click="removeChapter(ei, ci)">✕</NButton>
            </td>
          </tr>
        </tbody>
      </NTable>
    </NCard>

    <NCard v-if="editions.length">
      <NSpace vertical size="small">
        <NSpace>
          <NButton type="primary" @click="genXml">{{ $t('chapters.genXml') }}</NButton>
          <NButton v-if="tempFile" :disabled="!src" @click="applyToMkv">{{ $t('chapters.applyPropedit') }}</NButton>
          <NButton v-if="tempFile" quaternary @click="copyPath">{{ $t('chapters.copyPath') }}</NButton>
        </NSpace>
        <NTag v-if="tempFile" size="small" type="info">{{ tempFile }}</NTag>
        <pre
          v-if="xmlPreview"
          style="background: rgba(0, 0, 0, 0.35); padding: 12px; border-radius: 6px; font-size: 12px; overflow: auto; max-height: 40vh; margin: 0"
        >{{ xmlPreview }}</pre>
      </NSpace>
    </NCard>

    <NAlert v-else type="info" :show-icon="false">{{ $t('chapters.needSource') }}</NAlert>

    <FileBrowser v-model:show="browser" mode="file" filter="media" @select="(p: string) => { src = p; loadFromFile() }" />
  </NSpace>
</template>
