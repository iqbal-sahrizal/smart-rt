/* Smart RT — Conservative PWA Service Worker (v1) */
"use strict"

const SW_CACHE_PREFIX = "smart-rt-static-"
const SW_CACHE_VERSION = "v1"
const SW_STATIC_CACHE_NAME = `${SW_CACHE_PREFIX}${SW_CACHE_VERSION}`
const SW_OFFLINE_FALLBACK_URL = "/offline.html"

const SW_PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/icon-maskable-192x192.png",
  "/icons/icon-maskable-512x512.png",
  "/icons/apple-touch-icon.png",
]

const STATIC_REVALIDATE_PATHS = new Set([
  "/favicon.ico",
  "/manifest.webmanifest",
  "/offline.html",
])

function getHeader(headers, name) {
  if (!headers || typeof headers.get !== "function") return ""
  const val = headers.get(name)
  return typeof val === "string" ? val.trim() : ""
}

function classifyRequest(request, appOrigin) {
  const method = (request.method || "GET").toUpperCase()
  if (method !== "GET") {
    return "bypass"
  }

  let parsed
  try {
    parsed = new URL(request.url)
  } catch {
    return "bypass"
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "bypass"
  }

  if (parsed.origin !== appOrigin) {
    return "bypass"
  }

  const pathname = parsed.pathname

  if (pathname === "/sw.js") {
    return "bypass"
  }

  // Never intercept or cache API routes, auth callbacks, or private storage proxies
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/")
  ) {
    return "bypass"
  }

  // Never intercept or cache Next.js RSC requests, prefetches, Server Actions, or range/auth requests
  if (parsed.searchParams.has("_rsc")) {
    return "bypass"
  }

  const headers = request.headers
  if (
    getHeader(headers, "rsc") === "1" ||
    getHeader(headers, "next-action") !== "" ||
    getHeader(headers, "next-router-prefetch") !== "" ||
    getHeader(headers, "next-router-state-tree") !== "" ||
    getHeader(headers, "authorization") !== "" ||
    getHeader(headers, "range") !== ""
  ) {
    return "bypass"
  }

  if (pathname.startsWith("/_next/static/")) {
    return "cache-first-immutable"
  }

  if (pathname.startsWith("/_next/")) {
    return "bypass"
  }

  if (
    pathname.startsWith("/icons/") &&
    /\.(?:png|svg|ico|webp)$/i.test(pathname)
  ) {
    return "stale-while-revalidate-static"
  }

  if (STATIC_REVALIDATE_PATHS.has(pathname)) {
    return "stale-while-revalidate-static"
  }

  const accept = getHeader(headers, "accept")
  if (request.mode === "navigate" || accept.includes("text/html")) {
    return "network-only-navigate"
  }

  return "bypass"
}

function isResponseSafeToCache(response) {
  if (!response || response.status !== 200) {
    return false
  }
  if (response.type && response.type !== "basic") {
    return false
  }
  const headers = response.headers
  if (getHeader(headers, "set-cookie") !== "") {
    return false
  }
  const cc = getHeader(headers, "cache-control").toLowerCase()
  if (cc.includes("no-store") || cc.includes("private")) {
    return false
  }
  return true
}

self.addEventListener("install", (event) => {
  // Conservative activation: do NOT call self.skipWaiting() automatically here.
  // A waiting worker only activates when the user approves the update via SKIP_WAITING message
  // or when all tabs close naturally.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SW_STATIC_CACHE_NAME)
      await Promise.allSettled(
        SW_PRECACHE_URLS.map(async (url) => {
          const req = new Request(url, { cache: "reload" })
          const res = await fetch(req)
          if (isResponseSafeToCache(res)) {
            await cache.put(url, res)
          }
        })
      )
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const existingNames = await caches.keys()
      const obsolete = existingNames.filter(
        (name) =>
          name.startsWith(SW_CACHE_PREFIX) && name !== SW_STATIC_CACHE_NAME
      )
      await Promise.all(obsolete.map((name) => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const strategy = classifyRequest(request, self.location.origin)

  if (strategy === "bypass") {
    return
  }

  if (strategy === "cache-first-immutable") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SW_STATIC_CACHE_NAME)
        const cached = await cache.match(request)
        if (cached) {
          return cached
        }
        const networkResponse = await fetch(request)
        if (isResponseSafeToCache(networkResponse)) {
          await cache.put(request, networkResponse.clone())
        }
        return networkResponse
      })()
    )
    return
  }

  if (strategy === "stale-while-revalidate-static") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SW_STATIC_CACHE_NAME)
        const cached = await cache.match(request)
        const networkPromise = fetch(request)
          .then(async (networkResponse) => {
            if (isResponseSafeToCache(networkResponse)) {
              await cache.put(request, networkResponse.clone())
            }
            return networkResponse
          })
          .catch(() => null)

        if (cached) {
          event.waitUntil(networkPromise)
          return cached
        }

        const fresh = await networkPromise
        if (fresh) {
          return fresh
        }
        return new Response("Offline", { status: 503 })
      })()
    )
    return
  }

  if (strategy === "network-only-navigate") {
    event.respondWith(
      (async () => {
        try {
          // Always go to the network for HTML navigations; never cache authenticated HTML
          return await fetch(request)
        } catch {
          const cache = await caches.open(SW_STATIC_CACHE_NAME)
          const fallback = await cache.match(SW_OFFLINE_FALLBACK_URL)
          if (fallback) {
            const body = await fallback.arrayBuffer()
            return new Response(body, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate",
              },
            })
          }
          return new Response(
            "<!doctype html><html lang='id'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Koneksi Terputus</title></head><body><h1>Koneksi Internet Terputus</h1><p>Periksa sambungan internet Anda lalu muat ulang halaman.</p></body></html>",
            {
              status: 503,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
              },
            }
          )
        }
      })()
    )
  }
})

