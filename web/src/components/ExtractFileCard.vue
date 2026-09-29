<script setup lang="ts">
// 提取页单个源文件的配置卡片：轨道/附件/章节等勾选与输出名，argv 实时预览。
import { computed } from 'vue'
import { NAlert, NSpace, NButton, NCheckbox, NTable, NTag, NInput } from 'naive-ui'
import { fmtSize } from '../api'
import { buildArgv, type ExtractItem } from '../extract'

const props = defineProps<{ item: ExtractItem; outDir: string }>()

const argvText = computed(() => {
  const a = buildArgv(props.item, props.outDir)
  return a ? ['mkvextract', ...a].join(' ') : ''
})

const hasSubs = computed(() => (props.item.ident?.tracks || []).some((tr) => tr.type === 'subtitles'))

function selectSubtitles() {
  for (const tr of props.item.ident?.tracks || []) if (tr.type === 'subtitles') props.item.trackSel[tr.id] = true
}

function selectNone() {
  for (const id of Object.keys(props.item.trackSel)) props.item.trackSel[+id] = false
  for (const id of Object.keys(props.item.attachSel)) props.item.attachSel[+id] = false
  for (const id of Object.keys(props.item.tsSel)) props.item.tsSel[+id] = false
  props.item.wantChapters = false
  props.item.chaptersSimple = false
  props.item.wantTags = false
  props.item.wantCuesheet = false
  props.item.wantCues = false
}
</script>

<template>
  <NSpace vertical size="large">
    <NSpace :size="8" align="center">
      <NButton size="tiny" :disabled="!hasSubs" @click="selectSubtitles">{{ $t('extract.selAllSubs') }}</NButton>
      <NButton size="tiny" @click="selectNone">{{ $t('extract.selNone') }}</NButton>
    </NSpace>

    <div>
      <b style="font-size: 13px">{{ $t('extract.tracks') }}</b>
      <NTable size="small" :single-line="false" :bordered="false" style="margin-top: 6px">
        <thead>
          <tr>
            <th style="width: 60px"></th>
            <th style="width: 40px">ID</th>
            <th style="width: 80px">{{ $t('info.type') }}</th>
            <th style="width: 140px">{{ $t('info.codec') }}</th>
            <th>{{ $t('extract.outName') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tr in item.ident?.tracks" :key="'t' + tr.id">
            <td><NCheckbox v-model:checked="item.trackSel[tr.id]" size="small" /></td>
            <td>{{ tr.id }}</td>
            <td><NTag size="tiny" :bordered="false">{{ tr.type }}</NTag></td>
            <td style="font-size: 12px">{{ tr.codec }}</td>
            <td>
              <NInput v-if="item.trackSel[tr.id]" v-model:value="item.trackOut[tr.id]" size="small" />
            </td>
          </tr>
        </tbody>
      </NTable>
    </div>

    <div v-if="(item.ident?.attachments || []).length">
      <b style="font-size: 13px">{{ $t('extract.attachments') }}</b>
      <NTable size="small" :single-line="false" :bordered="false" style="margin-top: 6px">
        <thead>
          <tr>
            <th style="width: 60px"></th>
            <th style="width: 40px">ID</th>
            <th>{{ $t('common.fileName') }}</th>
            <th style="width: 100px">{{ $t('common.size') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in item.ident?.attachments" :key="'a' + a.id">
            <td><NCheckbox v-model:checked="item.attachSel[a.id]" size="small" /></td>
            <td>{{ a.id }}</td>
            <td>{{ a.name }}</td>
            <td>{{ fmtSize(a.size) }}</td>
          </tr>
        </tbody>
      </NTable>
    </div>

    <NSpace>
      <NCheckbox v-model:checked="item.wantChapters">{{ $t('extract.chaptersMode') }}</NCheckbox>
      <NCheckbox v-if="item.wantChapters" v-model:checked="item.chaptersSimple">{{ $t('extract.simpleChapters') }}</NCheckbox>
      <NCheckbox v-model:checked="item.wantTags">{{ $t('extract.tags') }}</NCheckbox>
      <NCheckbox v-model:checked="item.wantCuesheet">{{ $t('extract.cuesheet') }}</NCheckbox>
      <NCheckbox v-model:checked="item.wantCues">{{ $t('extract.cues') }}</NCheckbox>
    </NSpace>

    <div>
      <b style="font-size: 13px">{{ $t('extract.timestamps') }}</b>
      <NSpace style="margin-top: 6px">
        <NCheckbox
          v-for="tr in item.ident?.tracks"
          :key="'ts' + tr.id"
          v-model:checked="item.tsSel[tr.id]"
          size="small"
        >#{{ tr.id }} {{ tr.type }}</NCheckbox>
      </NSpace>
    </div>

    <NAlert v-if="argvText" type="info" :show-icon="false">
      <code style="word-break: break-all; font-size: 12px">$ {{ argvText }}</code>
    </NAlert>
  </NSpace>
</template>
