<script setup lang="ts">
// 信息工具：mkvmerge -J 结构化展示 + mkvinfo 原始输出
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NTag, NTable, NTabs, NTabPane, NAlert, NSelect, NSpin, useMessage, useThemeVars,
} from 'naive-ui'
import { api, fmtSize, type Identification } from '../api'
import FileBrowser from '../components/FileBrowser.vue'

const { t } = useI18n()
const message = useMessage()
const tv = useThemeVars()

const src = ref('')
const ident = ref<Identification | null>(null)
const loading = ref(false)
const raw = ref('')
const rawLevel = ref(1)
const rawLoading = ref(false)

const browser = ref(false)

async function load(p?: string) {
  const file = p || src.value
  if (!file) return
  src.value = file
  loading.value = true
  raw.value = ''
  try {
    ident.value = await api.identify(file)
  } catch (e: any) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}

async function loadRaw() {
  if (!src.value) return
  rawLoading.value = true
  try {
    const r = await api.rawInfo(src.value, rawLevel.value)
    raw.value = r.output
  } catch (e: any) {
    message.error(e.message)
  } finally {
    rawLoading.value = false
  }
}

function containerProps() {
  const p = ident.value?.container?.properties || {}
  const rows: [string, string][] = []
  const add = (k: string, label: string) => {
    if (p[k] !== undefined) rows.push([label, String(p[k])])
  }
  add('title', t('muxer.segTitle'))
  add('date_added', 'date')
  add('writing_application', 'writing app')
  add('muxing_application', 'muxing app')
  add('duration', 'duration (ns)')
  add('segment_uid', 'segment uid')
  if (p['segment_filename']) rows.push(['filename', p['segment_filename']])
  return rows
}

function trackPropRows(tr: any): [string, string][] {
  const skip = new Set(['track_name', 'language', 'language_ietf', 'default_track', 'forced_track', 'commentary_track'])
  return Object.entries(tr.properties || {})
    .filter(([k, v]) => !skip.has(k) && v !== null && typeof v !== 'object')
    .map(([k, v]) => [k, String(v)])
}
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('info.title')">
      <NSpace>
        <NInput :value="src" readonly :placeholder="$t('info.noFile')" style="width: 480px" @click="browser = true">
          <template #suffix>
            <NButton quaternary size="tiny" @click.stop="browser = true">{{ $t('common.browse') }}</NButton>
          </template>
        </NInput>
        <NButton type="primary" :loading="loading" :disabled="!src" @click="load()">{{ $t('info.load') }}</NButton>
      </NSpace>
    </NCard>

    <template v-if="ident">
      <NCard :title="$t('info.container')">
        <NTable size="small" :single-line="false" :bordered="false">
          <tbody>
            <tr v-for="[k, v] in containerProps()" :key="k">
              <td style="width: 200px; opacity: 0.7">{{ k }}</td>
              <td style="word-break: break-all">{{ v }}</td>
            </tr>
          </tbody>
        </NTable>
      </NCard>

      <NCard :title="$t('info.tracks')">
        <NTable size="small" :single-line="false" :bordered="false">
          <thead>
            <tr>
              <th style="width: 40px">ID</th>
              <th style="width: 90px">{{ $t('info.type') }}</th>
              <th style="width: 160px">{{ $t('info.codec') }}</th>
              <th style="width: 90px">{{ $t('info.lang') }}</th>
              <th>{{ $t('info.name') }}</th>
              <th style="width: 70px">{{ $t('info.default') }}</th>
              <th style="width: 70px">{{ $t('info.forced') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tr in ident.tracks" :key="tr.id">
              <td>{{ tr.id }}</td>
              <td><NTag size="tiny" :bordered="false">{{ tr.type }}</NTag></td>
              <td style="font-size: 12px">{{ tr.codec }}</td>
              <td>{{ tr.properties.language || tr.properties.language_ietf || 'und' }}</td>
              <td>{{ tr.properties.track_name || '-' }}</td>
              <td>{{ tr.properties.default_track ? '✓' : '' }}</td>
              <td>{{ tr.properties.forced_track ? '✓' : '' }}</td>
            </tr>
          </tbody>
        </NTable>
      </NCard>

      <NCard :title="$t('info.prop')">
        <NTabs type="line" animated>
          <NTabPane v-for="tr in ident.tracks" :key="'p' + tr.id" :name="'p' + tr.id" :tab="`#${tr.id} ${tr.type}`">
            <NTable size="small" :single-line="false" :bordered="false">
              <tbody>
                <tr v-for="[k, v] in trackPropRows(tr)" :key="k">
                  <td style="width: 240px; opacity: 0.7; word-break: break-all">{{ k }}</td>
                  <td style="word-break: break-all">{{ v }}</td>
                </tr>
              </tbody>
            </NTable>
          </NTabPane>
          <NTabPane v-if="(ident.attachments || []).length" name="att" :tab="$t('info.attachmentsTab')">
            <NTable size="small" :single-line="false" :bordered="false">
              <thead>
                <tr>
                  <th style="width: 40px">ID</th>
                  <th>{{ $t('common.fileName') }}</th>
                  <th style="width: 100px">{{ $t('common.size') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in ident.attachments" :key="a.id">
                  <td>{{ a.id }}</td>
                  <td>{{ a.name }}</td>
                  <td>{{ fmtSize(a.size) }}</td>
                </tr>
              </tbody>
            </NTable>
          </NTabPane>
        </NTabs>
      </NCard>

      <NCard :title="$t('info.raw')">
        <NSpace vertical size="small">
          <NSpace>
            <span style="font-size: 13px; opacity: 0.7">{{ $t('info.verbose') }}</span>
            <NSelect
              v-model:value="rawLevel"
              style="width: 120px"
              :options="[0, 1, 2, 3, 4].map((n) => ({ label: '-'.repeat(n) || '0', value: n }))"
            />
            <NButton :loading="rawLoading" :disabled="!src" @click="loadRaw">{{ $t('info.load') }}</NButton>
          </NSpace>
          <pre
            v-if="raw"
            :style="{ background: tv.actionColor, padding: '12px', borderRadius: '6px', fontSize: '12px', overflow: 'auto', maxHeight: '50vh', margin: '0' }"
          >{{ raw }}</pre>
        </NSpace>
      </NCard>
    </template>
    <NAlert v-else-if="!loading" type="info" :show-icon="false">{{ $t('info.noFile') }}</NAlert>

    <FileBrowser v-model:show="browser" mode="file" filter="media" @select="load($event)" />
  </NSpace>
</template>
