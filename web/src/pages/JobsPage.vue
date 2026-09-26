<script setup lang="ts">
import { h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NCard, NDataTable, NButton, NTag, NProgress, NSpace, NPopconfirm, NDropdown, useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { api, fmtTime, type Job } from '../api'
import { jobsState } from '../composables/jobs'
import LogDrawer from '../components/LogDrawer.vue'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()

const showLog = ref(false)
const logJob = ref<Job | null>(null)

const statusType = (s: Job['status']) =>
  (({
    queued: 'default',
    running: 'info',
    done: 'success',
    failed: 'error',
    canceled: 'warning',
    interrupted: 'warning',
  } as const)[s] || 'default')

const columns = ref<DataTableColumns<Job>>([
  { title: () => t('jobs.name'), key: 'name', minWidth: 200, ellipsis: { tooltip: true } },
  { title: () => t('jobs.tool'), key: 'tool', width: 110 },
  {
    title: () => t('jobs.status'),
    key: 'status',
    width: 130,
    render: (row) =>
      h(NTag, { type: statusType(row.status), size: 'small' }, {
        default: () =>
          row.status === 'done' && row.warning
            ? t('jobs.warningDone')
            : t('jobs.st_' + row.status),
      }),
  },
  {
    title: () => t('jobs.progress'),
    key: 'progress',
    width: 170,
    render: (row) =>
      h(NProgress, {
        type: 'line',
        percentage: row.progress,
        indicatorPlacement: 'inside',
        show: row.status === 'running' || row.status === 'done',
        status: row.status === 'failed' ? 'error' : row.warning ? 'warning' : 'success',
      }),
  },
  { title: () => t('jobs.created'), key: 'createdAt', width: 170, render: (r) => fmtTime(r.createdAt) },
  {
    title: () => t('jobs.actions'),
    key: 'actions',
    width: 240,
    render: (row) =>
      h(NSpace, { size: 'small' }, {
        default: () => [
          h(
            NButton,
            { size: 'tiny', onClick: () => { logJob.value = row; showLog.value = true } },
            { default: () => t('jobs.log') }
          ),
          row.status === 'running'
            ? h(
                NPopconfirm,
                { onPositiveClick: () => doCancel(row) },
                { trigger: () => h(NButton, { size: 'tiny', type: 'warning' }, { default: () => t('jobs.cancel') }), default: () => t('jobs.cancelConfirm') }
              )
            : null,
          ['failed', 'canceled', 'interrupted', 'done'].includes(row.status)
            ? h(NButton, { size: 'tiny', onClick: () => doRetry(row) }, { default: () => t('jobs.retry') })
            : null,
          h(
            NPopconfirm,
            { onPositiveClick: () => doDelete(row) },
            { trigger: () => h(NButton, { size: 'tiny', type: 'error', quaternary: true }, { default: () => t('common.delete') }), default: () => t('jobs.confirmDelete') }
          ),
        ],
      }),
  },
])

async function doCancel(row: Job) {
  try {
    await api.cancelJob(row.id)
  } catch (e: any) {
    message.error(e.message)
  }
}
async function doRetry(row: Job) {
  try {
    await api.retryJob(row.id)
    message.success(t('jobs.newJob') + ' ok')
  } catch (e: any) {
    message.error(e.message)
  }
}
async function doDelete(row: Job) {
  try {
    await api.deleteJob(row.id)
    jobsState.jobs = jobsState.jobs.filter((j) => j.id !== row.id)
  } catch (e: any) {
    message.error(e.message)
  }
}

async function doClearFinished() {
  try {
    const { removed } = await api.clearFinishedJobs()
    jobsState.jobs = jobsState.jobs.filter((j) => j.status === 'running' || j.status === 'queued')
    message.success(t('jobs.cleared', { n: removed }))
  } catch (e: any) {
    message.error(e.message)
  }
}

const newJobOptions = [
  { label: () => t('jobs.newMux'), key: '/muxer' },
  { label: () => t('jobs.newExtract'), key: '/extract' },
]
</script>

<template>
  <NCard :title="$t('menu.jobs')" style="height: 100%">
    <template #header-extra>
      <NSpace>
        <NPopconfirm @positive-click="doClearFinished">
          <template #trigger>
            <NButton
              :disabled="!jobsState.jobs.some((j) => j.status !== 'running' && j.status !== 'queued')"
            >{{ $t('jobs.clearFinished') }}</NButton>
          </template>
          {{ $t('jobs.clearFinishedConfirm') }}
        </NPopconfirm>
        <NDropdown :options="newJobOptions" @select="(k: string) => router.push(k)">
          <NButton type="primary">{{ $t('jobs.newJob') }}</NButton>
        </NDropdown>
      </NSpace>
    </template>
    <NDataTable :columns="columns" :data="jobsState.jobs" :bordered="false" size="small" />
    <LogDrawer v-model:show="showLog" :job="logJob" />
  </NCard>
</template>
