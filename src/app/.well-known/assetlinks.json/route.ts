import { NextResponse } from "next/server"

const DEBUG_STAGING_SHA256 =
  "39:85:FE:F3:F4:27:1E:5E:8B:32:39:AD:53:64:E3:06:12:E6:5C:01:FD:A8:E6:8D:1A:00:86:4E:A8:DC:20:AD"

interface AssetLinkStatement {
  relation: string[]
  target: {
    namespace: "android_app"
    package_name: string
    sha256_cert_fingerprints: string[]
  }
}

function parseReleaseFingerprints(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((fp) => fp.trim().toUpperCase())
    .filter((fp) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp))
}

export async function GET() {
  const statements: AssetLinkStatement[] = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "id.smartrt.resident.staging",
        sha256_cert_fingerprints: [DEBUG_STAGING_SHA256],
      },
    },
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "id.smartrt.resident.debug",
        sha256_cert_fingerprints: [DEBUG_STAGING_SHA256],
      },
    },
  ]

  const releaseFingerprints = parseReleaseFingerprints(
    process.env.ANDROID_RELEASE_SHA256_FINGERPRINTS
  )
  if (releaseFingerprints.length > 0) {
    statements.push({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "id.smartrt.resident",
        sha256_cert_fingerprints: releaseFingerprints,
      },
    })
  }

  return NextResponse.json(statements, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
}

