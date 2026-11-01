import { randomBytes } from 'node:crypto'
import { generateLicenseKeys } from '@inv/license-core'

// Run once, ever. Losing the private key means every shop needs a new build of the app.
const { publicKey, privateKey } = generateLicenseKeys()
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n')

console.log(`LICENSE_PRIVATE_KEY=${oneLine(privateKey)}`)
console.log(`SERIAL_HMAC_KEY=${randomBytes(32).toString('hex')}`)
console.log(`BETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}`)
console.log('')
console.log('Build the desktop app with:')
console.log(`MAIN_VITE_LICENSE_PUBLIC_KEY=${oneLine(publicKey)}`)
