import React, { useEffect, useMemo, useState } from 'react'
import { useMatrix } from '../matrix/client'

const HS_STORAGE_KEY = 'vanish.homeserver'
const SSO_USED_PREFIX = 'vanish.sso.used:'

function normalizeHs(input: string): string {
  const s = (input || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}
function isValidUrl(u: string): boolean {
  try { new URL(u); return true } catch { return false }
}

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { initPasswordLogin, finishSsoLoginWithToken } = useMatrix()

  const envDefault = import.meta.env.VITE_MATRIX_HOMESERVER_URL || ''
  const stored = (typeof window !== 'undefined' && localStorage.getItem(HS_STORAGE_KEY)) || ''
  const initial = normalizeHs(stored || envDefault)

  const [homeserver, setHomeserver] = useState(initial)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const normalizedHs = useMemo(() => normalizeHs(homeserver), [homeserver])

  // Persist HS as the user types (survives SSO round-trip)
  useEffect(() => {
    if (normalizedHs) localStorage.setItem(HS_STORAGE_KEY, normalizedHs)
  }, [normalizedHs])

  // Finish SSO if we returned with a loginToken (guarded)
  useEffect(() => {
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '')
    const token = hashParams.get('loginToken') || url.searchParams.get('loginToken')
    if (!token) return

    const guardKey = `${SSO_USED_PREFIX}${token}`
    if (sessionStorage.getItem(guardKey)) return
    sessionStorage.setItem(guardKey, '1')

    const hs = normalizeHs(localStorage.getItem(HS_STORAGE_KEY) || homeserver)
    if (!isValidUrl(hs)) {
      setError(`Invalid homeserver URL: "${hs || '(empty)'}"`)
      return
    }

    ;(async () => {
      try {
        setLoading(true)
        await finishSsoLoginWithToken({ homeserver: hs, token })
        // Clean token from URL and notify parent
        history.replaceState(null, '', url.origin + url.pathname)
        onLoggedIn()
      } catch (e: any) {
        sessionStorage.removeItem(guardKey)
        setError(e?.message ?? String(e))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const hs = normalizedHs
    if (!isValidUrl(hs)) {
      setError('Please enter a valid homeserver URL (e.g., https://synapse.example.com)')
      return
    }

    try {
      setLoading(true)
      await initPasswordLogin({ homeserver: hs, user, pass })
      onLoggedIn()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  function handleSSO() {
    setError(null)
    const hs = normalizedHs
    if (!isValidUrl(hs)) {
      setError('Please enter a valid homeserver URL before using SSO.')
      return
    }
    // Build the URL using the same client the provider will use internally
    // We can safely construct it via a simple pattern that matches matrix-js-sdk behaviour:
    const redirect = window.location.href
    // Let Synapse generate SSO URL via the discovery endpoint by sending user to /_matrix/client/r0/login
    // BUT easiest is using the sdk. Since we don't create a separate client here,
    // leverage the well-known format '/_matrix/client/v3/login' with redirect param:
    const ssoUrl = `${hs.replace(/\/+$/, '')}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(redirect)}`
    localStorage.setItem(HS_STORAGE_KEY, hs)
    window.location.assign(ssoUrl)
  }

  return (
    <div style={{ maxWidth: 420, margin: '10vh auto' }}>
      <h1>{import.meta.env.VITE_APP_NAME}</h1>
      <form onSubmit={doLogin}>
        <label>Homeserver</label>
        <input
          type="text"
          placeholder="https://synapse.your-domain.tld"
          value={homeserver}
          onChange={(e) => setHomeserver(e.target.value)}
          style={{ width: '100%' }}
        />

        <label>Username</label>
        <input value={user} onChange={(e) => setUser(e.target.value)} style={{ width: '100%' }} />

        <label>Password</label>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: '100%' }} />

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn" disabled={loading} type="submit">Log in</button>
          <button className="btn" disabled={loading} type="button" onClick={handleSSO}>Use SSO</button>
        </div>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  )
}
