import { generateLicenseKeys } from '@inv/license-core'

// Run once, on your own machine. Unlike the license key, this one never goes to the server.
const { publicKey, privateKey } = generateLicenseKeys()

console.log('Save this in a file outside the repository and keep a copy offline:')
console.log(privateKey)
console.log('Build the desktop app with:')
console.log(`MAIN_VITE_UPDATE_PUBLIC_KEY=${publicKey.trim().replace(/\n/g, '\\n')}`)
