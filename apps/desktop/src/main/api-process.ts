import { startApi, type RunningApi, type StartOptions } from '@inv/api'

export type ApiProcessRequest = { type: 'start'; options: StartOptions } | { type: 'stop' }
export type ApiProcessEvent = { type: 'ready'; port: number } | { type: 'failed'; message: string }

let api: RunningApi | undefined

process.parentPort.on('message', async ({ data }: { data: ApiProcessRequest }) => {
  if (data.type === 'stop') {
    await api?.stop()
    process.exit(0)
  }

  try {
    api = await startApi(data.options)
    process.parentPort.postMessage({ type: 'ready', port: api.port } satisfies ApiProcessEvent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.parentPort.postMessage({ type: 'failed', message } satisfies ApiProcessEvent)
  }
})
