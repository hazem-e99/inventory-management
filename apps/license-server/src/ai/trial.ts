// The accuracy check that decides whether invoice reading gets built:
//   GEMINI_API_KEY=... pnpm --filter @inv/license-server ai-trial D:/invoices
// Put the invoices in the folder. For each one, add a same-named .json with the true values
// (the shape is InvoiceReading) and the run scores it. Every file here is sent to Google, so use
// a billed project and invoices you have permission to use. This spends real money.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { invoiceReadingSchema, type AiMediaType } from '@inv/license-core'
import { geminiProvider } from './gemini'
import { costMicros, PRICED_MODELS } from './pricing'
import { AiUnreadable } from './provider'
import { scoreReading, type ReadingScore } from './score'

const TYPES: Record<string, AiMediaType> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf' }

const folder = process.argv[2]
const apiKey = process.env['GEMINI_API_KEY']
if (!folder || !apiKey) {
  console.error('Usage: GEMINI_API_KEY=... pnpm --filter @inv/license-server ai-trial <folder>')
  process.exit(1)
}

const files = readdirSync(folder).filter((name) => TYPES[extname(name).toLowerCase()])
const now = Date.now()
const results: Array<{ model: string; file: string; seconds: number; micros: number; score: ReadingScore | null; failed: boolean }> = []

for (const model of PRICED_MODELS) {
  const provider = geminiProvider(apiKey, model)

  for (const file of files) {
    const data = readFileSync(join(folder, file)).toString('base64')
    const truth = join(folder, file.replace(extname(file), '.json'))
    const expected = readdirSync(folder).includes(truth.slice(folder.length + 1)) ? invoiceReadingSchema.parse(JSON.parse(readFileSync(truth, 'utf8'))) : null

    const started = Date.now()
    const seconds = () => Math.round((Date.now() - started) / 100) / 10

    try {
      const { invoice, usage } = await provider.readInvoice({ data, mimeType: TYPES[extname(file).toLowerCase()]! })
      results.push({ model, file, seconds: seconds(), micros: costMicros(usage, now), score: expected && scoreReading(expected, invoice), failed: false })
    } catch (error) {
      // One slow or refused file is a result to report, not a reason to lose the whole run.
      results.push({ model, file, seconds: seconds(), micros: error instanceof AiUnreadable ? costMicros(error.usage, now) : 0, score: null, failed: true })
      if (!(error instanceof AiUnreadable)) console.log(`${model} ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
    console.log(`${model} ${file} done`)
  }
}

for (const model of PRICED_MODELS) {
  const rows = results.filter((row) => row.model === model)
  const scored = rows.flatMap(({ score }) => (score ? [score] : []))
  const numbers = scored.reduce((sum, score) => sum + score.numbers, 0)
  const right = scored.reduce((sum, score) => sum + score.numbersRight, 0)
  const micros = rows.reduce((sum, row) => sum + row.micros, 0)
  console.log(`\n${model}`)
  console.log(`  files ${rows.length}, failed ${rows.filter(({ failed }) => failed).length}`)
  console.log(`  slowest ${Math.max(...rows.map((row) => row.seconds), 0)}s`)
  console.log(`  quantities and prices right: ${numbers ? ((right / numbers) * 100).toFixed(1) : 'n/a'}% of ${numbers}`)
  console.log(`  totals right: ${scored.filter(({ totalRight }) => totalRight).length} of ${scored.length}`)
  console.log(`  cost per invoice: $${(micros / Math.max(rows.length, 1) / 1_000_000).toFixed(4)}`)
}

writeFileSync(join(folder, 'ai-trial-results.json'), JSON.stringify(results, null, 2))
