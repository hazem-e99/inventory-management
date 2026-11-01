import { createHmac, randomBytes } from 'node:crypto'

// Crockford's alphabet: no I, L, O or U, so a serial read over the phone can't be misheard.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const GROUPS = 4
const GROUP_LENGTH = 5
const LENGTH = GROUPS * GROUP_LENGTH

export function generateSerial(): string {
  const bytes = randomBytes(LENGTH)
  const characters = [...bytes].map((byte) => ALPHABET[byte & 31]!).join('')
  return characters.match(new RegExp(`.{${GROUP_LENGTH}}`, 'g'))!.join('-')
}

/** Forgives what people type: lower case, spaces, and letters that look like digits. */
export function normalizeSerial(text: string): string | null {
  const cleaned = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (cleaned.length !== LENGTH || [...cleaned].some((character) => !ALPHABET.includes(character))) return null
  return cleaned.match(new RegExp(`.{${GROUP_LENGTH}}`, 'g'))!.join('-')
}

/** Only this is stored, keyed so a stolen database can't be searched for serials. */
export const hashSerial = (serial: string, key: string): string => createHmac('sha256', key).update(serial).digest('hex')

/** Enough to recognise a serial on the phone without being able to use it. */
export const serialHint = (serial: string): string => serial.slice(-GROUP_LENGTH)
