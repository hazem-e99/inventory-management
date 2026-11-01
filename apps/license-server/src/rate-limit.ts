const WINDOW_MS = 60_000

/** Counts per key in a fixed window. One server, so memory is enough and restarts are harmless. */
export function rateLimiter(limit: number, clock: () => number) {
  const windows = new Map<string, { startedAt: number; count: number }>()

  return (key: string): boolean => {
    const now = clock()
    if (windows.size > 10_000) {
      for (const [entry, { startedAt }] of windows) {
        if (now - startedAt >= WINDOW_MS) windows.delete(entry)
      }
    }

    const current = windows.get(key)
    if (!current || now - current.startedAt >= WINDOW_MS) {
      windows.set(key, { startedAt: now, count: 1 })
      return true
    }
    current.count += 1
    return current.count <= limit
  }
}
