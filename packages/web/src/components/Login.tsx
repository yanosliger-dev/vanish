import React, { useEffect, useState } from 'react'
import { createClient } from 'matrix-js-sdk'
import { useMatrix } from '../matrix/client'

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { initPasswordLogin } = useMatrix()

  const [homeserver, setHomeserver] = useState(
    import.meta.env.VITE_MATRIX_HOMESERVER_URL || ''
  )
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Finish SSO if we returned with a loginToken (in hash or query)
  useEffect(() => {
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '')
    const token = hashParams.get('loginToken') || url.searchParams.get('loginToken')
    if (!token) return

    (async () => {
      try {
        setLoading(true)
        const client = createClient({ baseUrl: homeserver })
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
  }, [homeserver])

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await initPasswordLogin({ homeserver, user, pass })
      onLoggedIn()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  function handleSSO() {
    try {
      setError(null)
      const client = createClient({ baseUrl: homeserver })
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
