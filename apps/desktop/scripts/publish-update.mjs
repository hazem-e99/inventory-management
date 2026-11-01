// Prepares a release for the updates folder of the license server:
//   UPDATE_SIGNING_KEY_FILE=../keys/update.pem pnpm --filter @inv/desktop publish-update
// The key stays on your machine and never goes to the server.
import { createHash, sign } from 'node:crypto'
import { copyFileSync, createReadStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const releaseDir = resolve(import.meta.dirname, '../release')
const outputDir = process.env.UPDATE_OUTPUT_DIR ?? join(releaseDir, 'updates')
const keyFile = process.env.UPDATE_SIGNING_KEY_FILE

if (!keyFile) {
  console.error('UPDATE_SIGNING_KEY_FILE must point at the private update key.')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'))
const releaseVersion = process.env.UPDATE_VERSION ?? version
const installer = readdirSync(releaseDir).find((name) => name.endsWith('.exe') && name.includes(releaseVersion))
if (!installer) {
  console.error(`No installer for ${releaseVersion} in ${releaseDir}. Run pnpm dist first.`)
  process.exit(1)
}

const source = join(releaseDir, installer)
const file = `Inventory-Setup-${releaseVersion}.exe`
const hash = createHash('sha512')
await pipeline(createReadStream(source), hash)

const body = JSON.stringify({
  version: releaseVersion,
  file,
  sha512: hash.digest('hex'),
  size: statSync(source).size,
  publishedAt: Date.now(),
})
const signature = sign(null, Buffer.from(body), readFileSync(keyFile, 'utf8')).toString('base64url')

mkdirSync(outputDir, { recursive: true })
copyFileSync(source, join(outputDir, file))
writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify({ manifest: body, signature }))
console.log(`Upload ${file} first, then manifest.json, to the server's updates folder.`)
