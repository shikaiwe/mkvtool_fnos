<script setup lang="ts">
// 属性编辑页（Header Editor）：mkvpropedit 免重混流改头部
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NSwitch, NTag, NAlert, NTable, NInputNumber, useMessage,
} from 'naive-ui'
import { api, type Identification } from '../api'
import FileBrowser from '../components/FileBrowser.vue'

const { t } = useI18n()
const message = useMessage()

const src = ref('')
const ident = ref<Identification | null>(null)
const loading = ref(false)

const segTitle = ref('')
const segDate = ref('')

interface TrackEdit {
  id: number
  type: string
  codec: string
  name: string
  lang: string
  isDefault: boolean
  isForced: boolean
  isCommentary: boolean
}
const tracks = ref<TrackEdit[]>([])

const chaptersFile = ref('')
const attachAddPath = ref('')
const attachAddName = ref('')
const attachDelete = ref('')

const browser = ref(false)
const browserFor = ref<'src' | 'chapters' | 'attach'>('src')

async function load(p: string) {
  src.value = p
  ident.value = null
  tracks.value = []
  segTitle.value = ''
  segDate.value = ''
  loading.value = true
  try {
    ident.value = await api.identify(p)
    segTitle.value = ident.value?.container?.properties?.title || ''
    segDate.value = (ident.value?.container?.properties?.date_added || '').slice(0, 10)
    tracks.value = (ident.value?.tracks || []).map((tr) => ({
      id: tr.id,
      type: tr.type,
      codec: tr.codec,
      name: tr.properties.track_name || '',
      lang: tr.properties.language || tr.properties.language_ietf || 'und',
      isDefault: !!tr.properties.default_track,
      isForced: !!tr.properties.forced_track,
      isCommentary: !!tr.properties.commentary_track,
    }))
  } catch (e: any) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}

function onBrowserSelect(p: string) {
  if (browserFor.value === 'src') load(p)
  else if (browserFor.value === 'chapters') chaptersFile.value = p
  else if (browserFor.value === 'attach') attachAddPath.value = p
}

const argv = computed<string[]>(() => {
  if (!src.value) return []
  const args: string[] = []
  const infoSets: string[] = []
  const identTracks = ident.value?.tracks || []
  const infoProps = ident.value?.container?.properties || {}
  if (segTitle.value !== (infoProps.title || '')) infoSets.push(`title=${segTitle.value}`)
  if (segDate.value && segDate.value !== (infoProps.date_added || '').slice(0, 10)) {
    infoSets.push(`date=${segDate.value}`)
  }
  if (infoSets.length) {
    args.push('--edit', 'info')
    for (const s of infoSets) args.push('--set', s)
  }
  for (const tr of tracks.value) {
    const orig = identTracks.find((x) => x.id === tr.id)?.properties || {}
    const sets: string[] = []
    if (tr.name !== (orig.track_name || '')) sets.push(`name=${tr.name}`)
    if (tr.lang !== (orig.language || 'und')) sets.push(`language=${tr.lang}`)
    if (tr.isDefault !== !!orig.default_track) sets.push(`flag-default=${tr.isDefault ? 1 : 0}`)
    if (tr.isForced !== !!orig.forced_track) sets.push(`flag-forced=${tr.isForced ? 1 : 0}`)
    if (tr.isCommentary !== !!orig.commentary_track) sets.push(`flag-commentary=${tr.isCommentary ? 1 : 0}`)
    if (sets.length) {
      // mkvpropedit 的 track:n 从 1 起编号（官方文档），而 mkvmerge -J 的轨道 id 从 0 起，需 +1 对齐
      args.push('--edit', `track:${tr.id + 1}`)
      for (const s of sets) args.push('--set', s)
    }
  }
  if (chaptersFile.value) args.push('--chapters', chaptersFile.value)
  if (attachAddPath.value) {
    if (attachAddName.value) args.push('--attachment-name', attachAddName.value)
    args.push('--add-attachment', attachAddPath.value)
  }
  if (attachDelete.value.trim()) {
    for (const sel of attachDelete.value.split(',').map((s) => s.trim()).filter(Boolean)) {
      args.push(/^\d+$/.test(sel) ? '--delete-attachment' : '--delete-attachment', sel)
    }
  }
  return args
})

const argvText = computed(() => argv.value.join(' '))

async function submit() {
  if (!src.value) {
    message.warning(t('propedit.needFile'))
    return
  }
  if (!argv.value.length) {
    message.warning(t('common.none'))
    return
  }
  try {
    await api.createJob({ name: `propedit ${src.value.split(/[\\/]/).pop()}`, tool: 'mkvpropedit', argv: argv.value })
    message.success(t('propedit.submitted'))
  } catch (e: any) {
    message.error(e.message)
  }
}
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('propedit.title')">
      <NSpace vertical size="small">
        <NAlert type="warning" :show-icon="false">{{ $t('propedit.inPlace') }}</NAlert>
        <NSpace>
          <NInput :value="src" readonly :placeholder="$t('propedit.needFile')" style="width: 480px" @click="browserFor = 'src'; browser = true">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="browserFor = 'src'; browser = true">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
          <NButton type="primary" :loading="loading" :disabled="!src" @click="load(src)">{{ $t('info.load') }}</NButton>
        </NSpace>
      </NSpace>
    </NCard>

    <template v-if="ident">
      <NCard :title="$t('propedit.segInfo')">
        <NSpace>
          <div>
            <div style="font-size: 12px; opacity: 0.7; margin-bottom: 4px">{{ $t('propedit.segTitle') }}</div>
            <NInput v-model:value="segTitle" style="width: 320px" />
          </div>
          <div>
            <div style="font-size: 12px; opacity: 0.7; margin-bottom: 4px">{{ $t('propedit.date') }}</div>
            <NInput v-model:value="segDate" placeholder="2026-01-01" style="width: 200px" />
          </div>
        </NSpace>
      </NCard>

      <NCard :title="$t('propedit.trackEdits')">
        <NTable size="small" :single-line="false" :bordered="false">
          <thead>
            <tr>
              <th style="width: 40px">ID</th>
              <th style="width: 90px">{{ $t('info.type') }}</th>
              <th style="width: 140px">{{ $t('info.codec') }}</th>
              <th>{{ $t('muxer.trackName') }}</th>
              <th style="width: 110px">{{ $t('muxer.trackLang') }}</th>
              <th style="width: 60px">{{ $t('muxer.trackDefault') }}</th>
              <th style="width: 60px">{{ $t('muxer.trackForced') }}</th>
              <th style="width: 80px">{{ $t('muxer.trackCommentary') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tr in tracks" :key="tr.id">
              <td>{{ tr.id }}</td>
              <td><NTag size="tiny" :bordered="false">{{ tr.type }}</NTag></td>
              <td style="font-size: 12px">{{ tr.codec }}</td>
              <td><NInput v-model:value="tr.name" size="small" /></td>
              <td><NInput v-model:value="tr.lang" size="small" /></td>
              <td><NSwitch v-model:value="tr.isDefault" size="small" /></td>
              <td><NSwitch v-model:value="tr.isForced" size="small" /></td>
              <td><NSwitch v-model:value="tr.isCommentary" size="small" /></td>
            </tr>
          </tbody>
        </NTable>
      </NCard>

      <NCard :title="$t('propedit.chapterFile') + ' / ' + $t('muxer.attachments')">
        <NSpace vertical size="small">
          <div style="display: flex; gap: 8px; align-items: center">
            <span style="font-size: 13px; width: 180px">{{ $t('propedit.chapterFile') }}</span>
            <NInput :value="chaptersFile" readonly @click="browserFor = 'chapters'; browser = true">
              <template #suffix>
                <NButton quaternary size="tiny" @click.stop="browserFor = 'chapters'; browser = true">{{ $t('common.browse') }}</NButton>
              </template>
            </NInput>
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <span style="font-size: 13px; width: 180px">{{ $t('propedit.attachAdd') }}</span>
            <NInput :value="attachAddPath" readonly @click="browserFor = 'attach'; browser = true">
              <template #suffix>
                <NButton quaternary size="tiny" @click.stop="browserFor = 'attach'; browser = true">{{ $t('common.browse') }}</NButton>
              </template>
            </NInput>
            <NInput v-model:value="attachAddName" :placeholder="$t('propedit.attachName')" style="width: 220px" />
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <span style="font-size: 13px; width: 180px">{{ $t('propedit.attachDel') }}</span>
            <NInput v-model:value="attachDelete" placeholder="3, cover.png" style="width: 320px" />
          </div>
        </NSpace>
      </NCard>

      <NCard>
        <NSpace vertical size="small">
          <code style="display: block; word-break: break-all; opacity: 0.75; font-size: 12px">$ mkvpropedit {{ argvText }}</code>
          <NButton type="primary" :disabled="!argv.length" @click="submit">{{ $t('common.submit') }}</NButton>
        </NSpace>
      </NCard>
    </template>

    <FileBrowser v-model:show="browser" mode="file" :filter="browserFor === 'src' ? 'media' : ''" @select="onBrowserSelect" />
  </NSpace>
</template>
