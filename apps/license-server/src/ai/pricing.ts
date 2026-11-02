import type { AiUsage } from './provider'

interface Rate {
  from: number
  input: number
  output: number
}

// Dollars per million tokens, from ai.google.dev/gemini-api/docs/pricing on 2026-11-02.
// A later rate joins the list instead of replacing one, so past usage keeps its true cost.
const RATES: Record<string, Rate[]> = {
  'gemini-3.8-flash': [
    { from: 0, input: 0.75, output: 3.75 },
    { from: Date.UTC(2027, 0, 1), input: 1.5, output: 7.5 },
  ],
  'gemini-3.1-flash-lite': [{ from: 0, input: 0.25, output: 1.5 }],
}

export const PRICED_MODELS = Object.keys(RATES)

/** Millionths of a dollar. An unpriced model throws, because a budget can't guard what it can't count. */
export function costMicros(usage: AiUsage, at: number): number {
  const rate = RATES[usage.model]?.findLast(({ from }) => from <= at)
  if (!rate) throw new Error(`No price for ${usage.model}`)
  return Math.ceil(usage.inputTokens * rate.input + usage.outputTokens * rate.output)
}
