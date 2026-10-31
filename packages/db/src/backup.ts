import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, rename, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

/**
 * A backup is the encrypted database snapshot plus a header carrying the database key,
 * wrapped by the customer's recovery code. No plaintext copy ever reaches the disk, and the
 * file restores on a new machine where the original Windows-protected key no longer exists.
 */

const MAGIC = Buffer.from('INVBAK1\n', 'latin1')
const LENGTH_BYTES = 4
const MAX_HEADER_BYTES = 64 * 1024

// The code carries 120 random bits, so this KDF only has to stop cheap offline guessing.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_LENGTH = 24
const RECOVERY_GROUP = 4

export interface KeyEnvelope {
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export interface BackupHeader {
  format: 1
  createdAt: number
  appVersion: string
  latestMigration: string
  automatic: boolean
  sha256: string
  sizeBytes: number
  envelope: KeyEnvelope
}

function scrypt(code: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(code, salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_LENGTH)
  let code = ''
  for (const byte of bytes) code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]
  return code
}

export function formatRecoveryCode(code: string): string {
  return code.match(new RegExp(`.{1,${RECOVERY_GROUP}}`, 'g'))?.join('-') ?? code
}

export async function wrapKey(hexKey: string, recoveryCode: string): Promise<KeyEnvelope> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await scrypt(recoveryCode, salt), iv)
  const ciphertext = Buffer.concat([cipher.update(hexKey, 'utf8'), cipher.final()])
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

/** Returns the key, or null when the code is wrong: GCM authenticates the unwrap. */
export async function unwrapKey(envelope: KeyEnvelope, recoveryCode: string): Promise<string | null> {
  const key = await scrypt(recoveryCode, Buffer.from(envelope.salt, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export async function writeBackup(
  snapshotPath: string,
  destination: string,
  meta: Omit<BackupHeader, 'format' | 'sha256' | 'sizeBytes'>,
): Promise<BackupHeader> {
  const { size } = await stat(snapshotPath)
  const header: BackupHeader = {
    format: 1,
    sha256: await hashFile(snapshotPath),
    sizeBytes: size,
    ...meta,
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const length = Buffer.alloc(LENGTH_BYTES)
  length.writeUInt32LE(json.length)

  // Written beside the target and renamed, so a failed run never leaves a half backup.
  const temporary = `${destination}.partial`
  try {
    const output = createWriteStream(temporary)
    output.write(MAGIC)
    output.write(length)
    output.write(json)
    await pipeline(createReadStream(snapshotPath), output)
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return header
}

export async function readBackupHeader(
  path: string,
): Promise<{ header: BackupHeader; dataOffset: number } | null> {
  const file = await open(path, 'r')
  try {
    const prefix = Buffer.alloc(MAGIC.length + LENGTH_BYTES)
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0)
    if (bytesRead !== prefix.length) return null
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) return null

    const length = prefix.readUInt32LE(MAGIC.length)
    if (length === 0 || length > MAX_HEADER_BYTES) return null

    const json = Buffer.alloc(length)
    const read = await file.read(json, 0, length, prefix.length)
    if (read.bytesRead !== length) return null

    const header = JSON.parse(json.toString('utf8')) as BackupHeader
    if (header.format !== 1) return null
    return { header, dataOffset: prefix.length + length }
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  } finally {
    await file.close()
  }
}

/** Extracts the snapshot, refusing a file whose bytes no longer match its header. */
export async function extractBackup(
  path: string,
  dataOffset: number,
  header: BackupHeader,
  destination: string,
): Promise<boolean> {
  await pipeline(createReadStream(path, { start: dataOffset }), createWriteStream(destination))
  if ((await hashFile(destination)) === header.sha256) return true
  await rm(destination, { force: true })
  return false
}
