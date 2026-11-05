const missing = []

if (!process.env.GH_TOKEN) missing.push('GH_TOKEN')
if (!process.env.CSC_LINK && !process.env.CSC_NAME) missing.push('CSC_LINK or CSC_NAME')

const hasApiKeyCredentials =
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER
const hasAppleIdCredentials =
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
const hasKeychainCredentials = process.env.APPLE_KEYCHAIN && process.env.APPLE_KEYCHAIN_PROFILE

if (!hasApiKeyCredentials && !hasAppleIdCredentials && !hasKeychainCredentials) {
  missing.push('Apple notarisation credentials')
}

if (missing.length > 0) {
  console.error(`Release environment is incomplete. Missing: ${missing.join(', ')}.`)
  process.exit(1)
}
