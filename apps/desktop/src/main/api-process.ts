import { startApi, type RunningApi, type StartOptions } from '@inv/api'
import { fileLogger } from '@inv/api/log'

export type ApiProcessRequest = { type: 'start'; options: StartOptions } | { type: 'stop' }
export type ApiProcessEvent = { type: 'ready'; port: number } | { type: 'failed'; message: string }

let api: RunningApi | undefined

process.parentPort.on('message', async ({ data }: { data: ApiProcessRequest }) => {
  if (data.type === 'stop') {
    await api?.stop()
    process.exit(0)
  }

  const log = fileLogger(data.options.logsDir)
  process.on('uncaughtException', (error) => {
    log('Data service crashed', { message: error.message, stack: error.stack })
    process.exit(1)
  })

  try {
    api = await startApi(data.options)
    process.parentPort.postMessage({ type: 'ready', port: api.port } satisfies ApiProcessEvent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('Data service failed to start', { message })
    process.parentPort.postMessage({ type: 'failed', message } satisfies ApiProcessEvent)
  }
})
