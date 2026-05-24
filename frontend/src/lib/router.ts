// Tiny hash-based router so we don't pull in react-router for a 5-page app.
// State lives in window.location.hash. Listeners get the resolved route on
// every change so components can `useRoute()` without prop drilling.

import { useEffect, useState } from 'react'

export type Route =
  | { name: 'discover' }
  | { name: 'detail'; id: string }
  | { name: 'saved' }
  | { name: 'post' }
  | { name: 'edit'; id: string }
  | { name: 'owner' }
  | { name: 'admin' }
  | { name: 'profile' }
  | { name: 'inbox' }
  | { name: 'about' }
  | { name: 'feedback' }
  | { name: 'notfound'; path: string }

function parse(): Route {
  const raw = (window.location.hash || '').replace(/^#/, '') || '/'
  const [pathOnly] = raw.split('?')
  const path = pathOnly.replace(/^\/+/, '')
  if (path === '' || path === '/') return { name: 'discover' }
  if (path === 'saved') return { name: 'saved' }
  if (path === 'post') return { name: 'post' }
  if (path === 'owner') return { name: 'owner' }
  if (path === 'admin') return { name: 'admin' }
  if (path === 'profile') return { name: 'profile' }
  if (path === 'inbox') return { name: 'inbox' }
  if (path === 'about') return { name: 'about' }
  if (path === 'feedback') return { name: 'feedback' }
  if (path.startsWith('rooms/')) {
    const id = decodeURIComponent(path.slice(6))
    if (id) return { name: 'detail', id }
  }
  if (path.startsWith('edit/')) {
    const id = decodeURIComponent(path.slice(5))
    if (id) return { name: 'edit', id }
  }
  return { name: 'notfound', path }
}

const listeners = new Set<(r: Route) => void>()

window.addEventListener('hashchange', () => {
  const r = parse()
  for (const l of listeners) l(r)
})

export function navigate(path: string) {
  const h = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`
  if (window.location.hash !== h) window.location.hash = h
  else {
    const r = parse()
    for (const l of listeners) l(r)
  }
}

export function goDiscover() { navigate('/') }
export function goRoom(id: string) { navigate(`/rooms/${encodeURIComponent(id)}`) }
export function goSaved() { navigate('/saved') }
export function goPost() { navigate('/post') }
export function goEdit(id: string) { navigate(`/edit/${encodeURIComponent(id)}`) }
export function goOwner() { navigate('/owner') }
export function goAdmin() { navigate('/admin') }
export function goProfile() { navigate('/profile') }
export function goInbox() { navigate('/inbox') }
export function goAbout() { navigate('/about') }
export function goFeedback() { navigate('/feedback') }

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse())
  useEffect(() => {
    const fn = (r: Route) => setRoute(r)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return route
}
