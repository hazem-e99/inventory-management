import { v7 } from 'uuid'

/** Time-ordered, so ids sort by creation and index inserts stay append-like. */
export const newId = (): string => v7()
