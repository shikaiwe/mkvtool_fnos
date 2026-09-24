import { reactive } from 'vue'
import { api, wsUrl, type Job } from '../api'

// 任务列表状态：初始拉取 + WebSocket 实时更新 + 轮询兜底
interface JobsState {
  jobs: Job[]
  connected: boolean
  loaded: boolean
}

export const jobsState = reactive<JobsState>({ jobs: [], connected: false, loaded: false })

export async function refreshJobs() {
  try {
    jobsState.jobs = await api.jobs()
    jobsState.loaded = true
  } catch {
    /* 静默：下一次轮询再试 */
  }
}

function upsert(job: Job) {
  const i = jobsState.jobs.findIndex((j) => j.id === job.id)
  if (i >= 0) jobsState.jobs[i] = { ...jobsState.jobs[i], ...job }
  else jobsState.jobs.unshift(job)
}

let started = false
export function startJobsSync() {
  if (started) return
  started = true
  refreshJobs()
  setInterval(refreshJobs, 8000) // 兜底轮询

  const connect = () => {
    const ws = new WebSocket(wsUrl())
    ws.onopen = () => (jobsState.connected = true)
    ws.onclose = () => {
      jobsState.connected = false
      setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'job') upsert(msg.job)
      } catch {
        /* ignore */
      }
    }
  }
  connect()
}
