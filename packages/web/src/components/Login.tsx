import React, { useState } from 'react'
import { useMatrix } from '../matrix/client'

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { initPasswordLogin, initSSO } = useMatrix()
  const [homeserver] = useState(import.meta.env.VITE_MATRIX_HOMESERVER_URL)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      await initPasswordLogin({ homeserver, user, pass })
      onLoggedIn()
    } catch (e:any) {
      setError(e.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '10vh auto' }}>
      <h1>{import.meta.env.VITE_APP_NAME}</h1>
      <form onSubmit={doLogin}>
        <label>Homeserver</label>
        <input value={homeserver} readOnly style={{ width: '100%' }} />
        <label>Username</label>
        <input value={user} onChange={e=>setUser(e.target.value)} style={{ width: '100%' }} />
        <label>Password</label>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} style={{ width: '100%' }} />
        <div style={{ display:'flex', gap:8, marginTop:12 }}>
          <button className="btn" disabled={loading} type="submit">Log in</button>
          <button className="btn" disabled={loading} type="button" onClick={()=>initSSO({ homeserver })}>Use SSO</button>
        </div>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  )
}
