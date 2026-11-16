export interface SecurityHeaderEntry {
  key: string
  value: string
}

/**
 * Builds global HTTP security headers for Next.js responses.
 * HSTS is strictly restricted to production HTTPS deployments to avoid breaking local HTTP dev servers.
 */
export function buildGlobalSecurityHeaders(
  isProduction: boolean = process.env.NODE_ENV === "production"
): SecurityHeaderEntry[] {
  const headers: SecurityHeaderEntry[] = [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ]

  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    })
  }

  return headers
}

