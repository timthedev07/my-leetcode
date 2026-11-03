export function buildContentSecurityPolicy(development: boolean): string {
  const connectSources = development ? "'self' ws://localhost:* http://localhost:*" : "'self'"
  const scriptSources = development ? "'self' 'unsafe-inline'" : "'self'"
  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}
