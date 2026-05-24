// Web tier: serve the built Vite bundle + proxy /api/* to the api process. Same
// pattern as the sibling project. BIND_HOST defaults to loopback for direct host
// use; the Dockerfile sets it to 0.0.0.0 so Docker's port proxy can reach us.

import http from 'node:http'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import path from 'node:path'

const root = process.cwd()
const distDir = path.join(root, 'dist')
const port = Number(process.env.PORT || 4174)
const bindHost = process.env.BIND_HOST || '127.0.0.1'
const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8788'
const isProd = process.env.NODE_ENV === 'production'
const publicUrl = (process.env.PUBLIC_URL || '').trim()
// CSP allow-list for Cloudinary. Only widened when the cloud name is set —
// keeps the CSP tight when local-upload-only deploys are in use.
const cloudinaryCloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim()

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt'])

function securityHeaders() {
  const connectSrc = ["'self'"]
  if (publicUrl) connectSrc.push(publicUrl)
  // Signed-upload XHR goes to api.cloudinary.com; the response is delivered
  // via the matching res.cloudinary.com host (covered by img-src below).
  if (cloudinaryCloudName) connectSrc.push('https://api.cloudinary.com')
  // Concrete img-src allow-list — narrower than `https:` so an injected
  // <img src="https://attacker.example/pixel"> can't beacon out. Hosts:
  //   - picsum.photos              → seed/demo room images
  //   - lh3.googleusercontent.com  → Google profile avatars + Drive thumbs
  //   - drive.google.com           → Drive thumbnail endpoint (redirects to
  //                                  lh3.googleusercontent.com)
  //   - www.gravatar.com           → fallback avatar host for OAuth providers
  //   - res.cloudinary.com         → only when CLOUDINARY_CLOUD_NAME is set;
  //                                  scoped to the configured cloud below
  // /uploads/* is served same-origin via the proxy, so 'self' covers it.
  const imgSrc = [
    "'self'", 'data:', 'blob:',
    'https://picsum.photos',
    'https://lh3.googleusercontent.com',
    'https://drive.google.com',
    'https://www.gravatar.com',
  ]
  if (cloudinaryCloudName) imgSrc.push(`https://res.cloudinary.com/${cloudinaryCloudName}/`)
  return {
    'Strict-Transport-Security': isProd ? 'max-age=31536000; includeSubDomains' : '',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // geolocation is disabled — the app does not request it anywhere. Keep
    // camera/microphone/payment off for the same reason. Re-add `self` to a
    // feature only when the corresponding browser API is actually used.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      // Vite ships a hashed module entry — no inline <script> is generated,
      // so we don't need 'unsafe-inline' or 'unsafe-eval' for scripts. Keeping
      // them out limits XSS blast radius if a HTML injection ever lands.
      "script-src 'self'",
      // Tailwind utilities + React components routinely set the style="…"
      // attribute, which requires 'unsafe-inline' here. Tightening this would
      // need nonces or hashes across the bundle.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      `img-src ${imgSrc.join(' ')}`,
      `connect-src ${connectSrc.join(' ')}`,
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  }
}
const SECURITY_HEADERS = Object.fromEntries(
  Object.entries(securityHeaders()).filter(([, v]) => v),
)

const sendText = (res, status, text, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...SECURITY_HEADERS, ...extraHeaders,
  })
  res.end(text)
}

// undici fetch transparently decodes gzip/deflate responses, so the upstream's
// content-encoding / content-length no longer describe the bytes we forward —
// passing them through makes the browser try to gunzip plain JSON and fail with
// ERR_CONTENT_DECODING_FAILED. Force identity upstream and drop hop-by-hop
// headers on the way back.
const STRIP_UPSTREAM_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding',
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'upgrade',
])
const proxyApi = async (req, res) => {
  const target = new URL(req.url || '/', backendUrl)
  const body = ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { ...req.headers, 'accept-encoding': 'identity' },
      body,
      duplex: body ? 'half' : undefined,
    })
    const upstreamHeaders = {}
    for (const [k, v] of upstream.headers.entries()) {
      if (!STRIP_UPSTREAM_HEADERS.has(k.toLowerCase())) upstreamHeaders[k] = v
    }
    res.writeHead(upstream.status, { ...upstreamHeaders, ...SECURITY_HEADERS })
    if (upstream.body) { for await (const chunk of upstream.body) res.write(chunk) }
    res.end()
  } catch (error) {
    // Log the underlying cause server-side, return a generic body to the
    // client — `String(error)` can contain ECONNREFUSED targets, file paths,
    // or other internal hints we don't want shipping to a browser.
    console.error('[web] proxy error', error)
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS })
    res.end(JSON.stringify({ ok: false, error: 'Backend tạm thời chưa sẵn sàng.' }))
  }
}

function clientAcceptsGzip(req) {
  const ae = req.headers['accept-encoding'] || ''
  return /\bgzip\b/.test(ae)
}

const serveFile = async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  // /api/* and /uploads/* are both owned by the backend API process — proxy
  // them through identical machinery so the static tier never touches the
  // data dir directly.
  if (url.pathname.startsWith('/api/')) return proxyApi(req, res)
  if (url.pathname.startsWith('/uploads/')) return proxyApi(req, res)
  if (url.pathname === '/healthz') return sendText(res, 200, 'ok')
  if (url.pathname === '/robots.txt') return sendText(res, 200, 'User-agent: *\nAllow: /\n')

  const rawPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  const candidate = path.normalize(path.join(distDir, rawPath))
  if (!candidate.startsWith(distDir)) return sendText(res, 403, 'Forbidden')

  try {
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) throw new Error('not file')
    const ext = path.extname(candidate)
    const isAsset = candidate.includes(`${path.sep}assets${path.sep}`)
    const useGzip = COMPRESSIBLE.has(ext) && clientAcceptsGzip(req) && stat.size > 1024
    const headers = {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store',
      'Vary': 'Accept-Encoding',
      ...SECURITY_HEADERS,
    }
    if (useGzip) {
      headers['Content-Encoding'] = 'gzip'
      res.writeHead(200, headers)
      await pipeline(createReadStream(candidate), createGzip({ level: zlib.constants.Z_BEST_SPEED }), res)
    } else {
      headers['Content-Length'] = stat.size
      res.writeHead(200, headers)
      createReadStream(candidate).pipe(res)
    }
  } catch {
    const indexPath = path.join(distDir, 'index.html')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS })
    createReadStream(indexPath).pipe(res)
  }
}

const server = http.createServer(serveFile)
server.listen(port, bindHost, () => {
  console.log(`[web] serving dist on http://${bindHost}:${port}`)
  console.log(`[web] proxying /api/* to ${backendUrl}`)
})
