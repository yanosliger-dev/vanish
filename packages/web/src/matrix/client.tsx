import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createClient, MatrixClient, Room } from 'matrix-js-sdk'

type LoginResult = {
  accessToken: string
  userId: string
  deviceId?: string
  wellKnown?: any
}

type MatrixCtx = {
  client: MatrixClient | null
  ready: boolean
  syncing: boolean
  rooms: Room[]
  homeserver: string | null

  // login flows
  initPasswordLogin(args: { homeserver: string; user: string; pass: string }): Promise<void>
  finishSsoLoginWithToken(args: { homeserver: string; token: string }): Promise<void>

  // restore existing session (optional)
  startWithAccessToken(args: { homeserver: string; userId: string; accessToken: string; deviceId?: string }): Promise<void>

  // logout
  logout(): Promise<void>
}

const HS_STORAGE_KEY = 'vanish.homeserver'
const SESSION_KEY = 'vanish.session' // stores {userId, accessToken, deviceId}

const Ctx = createContext<MatrixCtx | null>(null)

function normalizeHs(input: string): string {
  const s = (input || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

function sortRooms(rs: Room[]): Room[] {
  return [...rs].sort((a, b) => (b.getLastActiveTs() || 0) - (a.getLastActiveTs() || 0))
}

export function MatrixProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<MatrixClient | null>(null)
  const [ready, setReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [rooms, setRooms] = useState<Room[]>([])
  const [homeserver, setHomeserver] = useState<string | null>(null)

  const startedRef = useRef(false)

  // Helper to bind events and keep rooms fresh
  function bindClient(c: MatrixClient) {
    const refresh = () => setRooms(sortRooms(c.getVisibleRooms?.() ?? c.getRooms()))
    c.on('Room', refresh)
    c.on('Room.timeline', refresh)
    c.on('Room.name', refresh)
    c.on('Room.accountData', refresh)
    c.on('deleteRoom', refresh)
    c.on('Room.receipt', refresh)

    c.on('sync', (state) => {
      if (state === 'PREPARED') {
        setReady(true)
        refresh()
      }
      setSyncing(state === 'SYNCING' || state === 'CATCHUP')
    })
  }

  async function start(c: MatrixClient) {
    if (startedRef.current) return
    startedRef.current = true
    bindClient(c)
    await c.startClient({ initialSyncLimit: 30, lazyLoadMembers: true })
  }

  async function initPasswordLogin({ homeserver, user, pass }: { homeserver: string; user: string; pass: string }) {
    const hs = normalizeHs(homeserver)
    const c = createClient({ baseUrl: hs })
    const res = await c.login('m.login.password', { user, password: pass }) as unknown as LoginResult
    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId }))
    setHomeserver(hs)
    setClient(c)
    await start(c)
  }

  async function finishSsoLoginWithToken({ homeserver, token }: { homeserver: string; token: string }) {
    const hs = normalizeHs(homeserver)
    const c = createClient({ baseUrl: hs })
    const res = await c.loginWithToken(token) as unknown as LoginResult
    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId }))
    setHomeserver(hs)
    setClient(c)
    await start(c)
  }

  async function startWithAccessToken({ homeserver, userId, accessToken, deviceId }: { homeserver: string; userId: string; accessToken: string; deviceId?: string }) {
    const hs = normalizeHs(homeserver)
    const c = createClient({ baseUrl: hs, userId, accessToken, deviceId })
    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, accessToken, deviceId }))
    setHomeserver(hs)
    setClient(c)
    await start(c)
  }

  async function logout() {
    try { await client?.logout?.() } catch {}
    try { await client?.stopClient?.() } catch {}
    setClient(null)
    setRooms([])
    setReady(false)
    setSyncing(false)
    startedRef.current = false
    localStorage.removeItem(SESSION_KEY)
  }

  // Auto-restore session on mount
  useEffect(() => {
    const hs = normalizeHs(localStorage.getItem(HS_STORAGE_KEY) || '')
    const raw = localStorage.getItem(SESSION_KEY)
    if (!hs || !raw) return
    try {
      const s = JSON.parse(raw)
      setHomeserver(hs)
      startWithAccessToken({ homeserver: hs, userId: s.userId, accessToken: s.accessToken, deviceId: s.deviceId })
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<MatrixCtx>(() => ({
    client, ready, syncing, rooms, homeserver,
    initPasswordLogin,
    finishSsoLoginWithToken,
    startWithAccessToken,
    logout,
  }), [client, ready, syncing, rooms, homeserver])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMatrix(): MatrixCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMatrix must be used within <MatrixProvider>')
  return v
}
