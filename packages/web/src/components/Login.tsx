import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from 'matrix-js-sdk'

const HS_STORAGE_KEY = 'vanish.homeserver'

function normalizeHs(input: string): string {
  const s = (input || '').trim()
  if (!s) return ''
  // Add scheme if user typed just the host
  if (!/^https?:\/\//i.test(s)) return `https://${s}`
  return s
}

function isValidUrl(u: string): boolean {
  try { new URL(u); return true } catch { return false }
}

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const envDefault = import.meta.env.VITE_MATRIX_HOMESERVER_URL || ''
  const stored = (typeof window !== 'undefined' && localStorage.getItem(HS_STORAGE_KEY)) || ''
  const initial = normalizeHs(stored || envDefault)

  const [homeserver, setHomeserver] = useState(initial)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const normalizedHs = useMemo(() => normalizeHs(homeserver), [homeserver])

  // Persist HS as the user types (so it's available after SSO round-trip)
  useEffect(() => {
    if (normalizedHs) localStorage.setItem(HS_STORAGE_KEY, normalizedHs)
  }, [normalizedHs])

  // Finish SSO if we returned with a loginToken
  useEffect(() => {
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '')
    const token = hashParams.get('loginToken') || url.searchParams.get('loginToken')
    if (!token) return

    const hs = normalizeHs(localStorage.getItem(HS_STORAGE_KEY) || homeserver)

    if (!isValidUrl(hs)) {
      setError(`Invalid homeserver URL: "${hs || '(empty)'}"`)
      return
    }

    (async () => {
      try {
        setLoading(true)
        const client = createClient({ baseUrl: hs })
        await client.loginWithToken(token)
        await client.startClient()

        // Clean token from the URL
        history.replaceState(null, '', url.origin + url.pathname)
        onLoggedIn()
      } catch (e: any) {
        setError(e?.message ?? String(e))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

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
      // If you have your own hook, call it here. For demo, do raw password login:
      const client = createClient({ baseUrl: hs })
      await client.login('m.login.password', { user, password: pass })
      await client.startClient()
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

    try {
      localStorage.setItem(HS_STORAGE_KEY, hs) // ensure it survives the redirect
      const client = createClient({ baseUrl: hs })
      const redirect = window.location.href
      const url = client.getSsoLoginUrl(redirect)
      window.location.assign(url)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
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
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          style={{ width: '100%' }}
        />

        <label>Password</label>
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          style={{ width: '100%' }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn" disabled={loading} type="submit">Log in</button>
          <button className="btn" disabled={loading} type="button" onClick={handleSSO}>Use SSO</button>
        </div>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  )
}
