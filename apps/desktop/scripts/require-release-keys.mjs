// A build without these would either fail on the customer's machine or trust the development key.
const key = process.env.MAIN_VITE_LICENSE_PUBLIC_KEY
const url = process.env.MAIN_VITE_LICENSE_SERVER_URL

if (!key || !key.includes('PUBLIC KEY')) {
  console.error('MAIN_VITE_LICENSE_PUBLIC_KEY is missing. Run the generate-keys command of the license server once.')
  process.exit(1)
}

const local = process.env.ALLOW_LOCAL_LICENSE_SERVER === '1' && url?.startsWith('http://127.0.0.1')
if (!url || (!url.startsWith('https://') && !local)) {
  console.error('MAIN_VITE_LICENSE_SERVER_URL must be the https address of the license server.')
  process.exit(1)
}
