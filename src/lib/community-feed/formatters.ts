const COMMUNITY_DATETIME_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export function formatCommunityTimeAgo(isoTimestamp: string): string {
  const then = Date.parse(isoTimestamp)
  if (Number.isNaN(then)) return ""

  const diffMs = Date.now() - then
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 0 || diffSec < 60) return "Baru saja"
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} menit lalu`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} jam lalu`
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} hari lalu`

  return COMMUNITY_DATETIME_FORMATTER.format(new Date(then))
}

export function formatCommunityFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatCommunityCount(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}rb`
  return `${(count / 1_000_000).toFixed(1)}jt`
}
