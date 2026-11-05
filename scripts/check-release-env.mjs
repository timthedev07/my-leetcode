const missing = []

if (!process.env.GH_TOKEN) missing.push('GH_TOKEN')

if (missing.length > 0) {
  console.error(`Release environment is incomplete. Missing: ${missing.join(', ')}.`)
  process.exit(1)
}
