import { toast } from 'vue-sonner'
import { api } from './useApi'

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function useAgent() {
  const running = ref(false)
  const runningType = ref<string | null>(null)

  async function run(type: string, msg: string, dramaId: number, episodeId: number, onDone?: () => void, model?: string, configId?: number) {
    if (running.value) { toast.warning('操作执行中'); return }
    running.value = true
    runningType.value = type
    try {
      const data = await api.post<any>(`/agent/${type}/chat`, {
        message: msg,
        drama_id: dramaId,
        episode_id: episodeId,
        model: model || undefined,
        config_id: configId || undefined,
      })
      const jobId = data?.job_id
      if (jobId) {
        const deadline = Date.now() + 15 * 60 * 1000
        while (Date.now() < deadline) {
          await sleep(2000)
          const job = await api.get<any>(`/agent/${type}/jobs/${jobId}`)
          if (job?.status === 'done') break
          if (job?.status === 'error') throw new Error(job.error || 'Agent failed')
        }
      }
      toast.success('完成')
      onDone?.()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      running.value = false
      runningType.value = null
    }
  }

  return { running, runningType, run }
}
