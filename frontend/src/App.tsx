import { useEffect } from 'react'
import { AppShell } from './components/AppShell'
import { LoginPopup } from './components/LoginPopup'
import { AuthProvider, useAuth } from './lib/auth'
import { useRoute, goDiscover } from './lib/router'
import { DiscoverPage } from './pages/Discover'
import { RoomDetailPage } from './pages/RoomDetail'
import { SavedPage } from './pages/Saved'
import { PostPage } from './pages/Post'
import { OwnerPage } from './pages/Owner'
import { AdminPage } from './pages/Admin'
import { ProfilePage } from './pages/Profile'
import { InboxPage } from './pages/Inbox'
import { AboutPage } from './pages/About'
import { FeedbackPage } from './pages/Feedback'
import { NotFoundPage } from './pages/NotFound'

export function App() {
  return (
    <AuthProvider>
      <GoogleOAuthHandler />
      <AppShell>
        <RouteSwitch />
      </AppShell>
      <LoginPopup />
    </AuthProvider>
  )
}

function RouteSwitch() {
  const route = useRoute()
  switch (route.name) {
    case 'discover': return <DiscoverPage />
    case 'detail': return <RoomDetailPage roomId={route.id} />
    case 'saved': return <SavedPage />
    case 'post': return <PostPage />
    case 'edit': return <PostPage editId={route.id} />
    case 'owner': return <OwnerPage />
    case 'admin': return <AdminPage />
    case 'profile': return <ProfilePage />
    case 'inbox': return <InboxPage />
    case 'about': return <AboutPage />
    case 'feedback': return <FeedbackPage />
    case 'notfound': return <NotFoundPage path={route.path} />
  }
}

// Detect ?code=… on the URL (Google redirects back with it) and exchange via API.
// We only run once at boot, then strip the query string. `state` is the
// opaque server-issued nonce — we pass it through verbatim; the backend
// validates and consumes it.
function GoogleOAuthHandler() {
  const auth = useAuth()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    if (!code || !state) return
    auth.loginWithGoogle(code, state)
      .catch(() => { /* surfaced via popup if user retries */ })
      .finally(() => {
        // Clean URL so a refresh doesn't reuse the consumed code.
        const url = new URL(window.location.href)
        url.search = ''
        window.history.replaceState({}, '', url.toString())
        goDiscover()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
