// Container supervisor: spawn api + web as siblings, forward signals,
// exit the container if either child dies. Same pattern as the sibling
// project — keeps the runtime image lean (no PM2, no systemd).

import { spawn } from 'node:child_process'
import process from 'node:process'

const children = []
let shuttingDown = false

function start(name, args, env) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  child.name = name
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[entry] ${name} exited (code=${code}, signal=${signal}) — shutting down container`)
    shutdown(code ?? 1)
  })
  child.on('error', (err) => {
    console.error(`[entry] ${name} failed to spawn:`, err)
    shutdown(1)
  })
  children.push(child)
  return child
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) {
    if (!c.killed && c.exitCode === null) { try { c.kill('SIGTERM') } catch { /* ignore */ } }
  }
  setTimeout(() => process.exit(code), 5000).unref()
  let pending = children.length
  if (pending === 0) process.exit(code)
  for (const c of children) c.once('exit', () => { if (--pending === 0) process.exit(code) })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`[entry] received ${sig}`); shutdown(0) })
}

const apiPort = process.env.API_PORT || '8788'
const webPort = process.env.PORT || '4174'

start('api', ['backend/src/api.mjs'], { API_PORT: apiPort })
start('web', ['backend/src/web.mjs'], {
  PORT: webPort,
  BACKEND_URL: process.env.BACKEND_URL || `http://127.0.0.1:${apiPort}`,
})

console.log(`[entry] supervising api(:${apiPort}) + web(:${webPort})`)
