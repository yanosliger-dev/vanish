import React, { useEffect, useMemo, useState } from 'react'
import { useMatrix } from '../matrix/client'

const HS_STORAGE_KEY = 'vanish.homeserver'
const SSO_USED_PREFIX = 'vanish.sso.used:'

function normalizeHs(input: string): string {
  const s = (input || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}
function isValidUrl(u: string): boolean { try { new URL(u); return true } catch { return false } }

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

  useEffect(() => { if (normalizedHs) localStorage.setItem(HS_STORAGE_KEY, normalizedHs) }, [normalizedHs])

  useEffect(() => {
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '')
    const token = hashParams.get('loginToken') || url.searchParams.get('loginToken')
    if (!token) return
    const guardKey = `${SSO_USED_PREFIX}${token}`
    if (sessionStorage.getItem(guardKey)) return
    sessionStorage.setItem(guardKey, '1')

    const hs = normalizeHs(localStorage.getItem(HS_STORAGE_KEY) || homeserver)
    if (!isValidUrl(hs)) { setError(`Invalid homeserver URL: "${hs || '(empty)'}"`); return }

    ;(async () => {
      try {
        setLoading(true)
        await finishSsoLoginWithToken({ homeserver: hs, token })
        history.replaceState(null, '', url.origin + url.pathname)
        onLoggedIn()
      } catch (e: any) {
        sessionStorage.removeItem(guardKey)
        setError(e?.message ?? String(e))
      } finally { setLoading(false) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isValidUrl(normalizedHs)) { setError('Enter a valid homeserver URL'); return }
    try {
      setLoading(true)
      await initPasswordLogin({ homeserver: normalizedHs, user, pass })
      onLoggedIn()
    } catch (e: any) { setError(e?.message ?? String(e)) }
    finally { setLoading(false) }
  }

  function handleSSO() {
    setError(null)
    if (!isValidUrl(normalizedHs)) { setError('Enter a valid homeserver URL before using SSO.'); return }
    localStorage.setItem(HS_STORAGE_KEY, normalizedHs)
    const redirect = window.location.href
    const ssoUrl = `${normalizedHs.replace(/\/+$/, '')}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(redirect)}`
    window.location.assign(ssoUrl)
  }

  return (
    <div style={{ maxWidth: 420, margin: '10vh auto' }}>
      <h1>{import.meta.env.VITE_APP_NAME}</h1>
      <form onSubmit={doLogin}>
        <label>Homeserver</label>
        <input className="input" type="text" placeholder="https://synapse.your-domain.tld"
               value={homeserver} onChange={(e)=>setHomeserver(e.target.value)} />
        <label>Username</label>
        <input className="input" value={user} onChange={(e)=>setUser(e.target.value)} />
        <label>Password</label>
        <input className="input" type="password" value={pass} onChange={(e)=>setPass(e.target.value)} />
        <div style={{ display:'flex', gap:8, marginTop:12 }}>
          <button className="btn" disabled={loading} type="submit">Log in</button>
          <button className="btn" disabled={loading} type="button" onClick={handleSSO}>Use SSO</button>
        </div>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  )
}
