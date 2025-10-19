import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createClient, MatrixClient, Room } from 'matrix-js-sdk'
import { initCryptoEarly } from './cryptoInit'

/* ---------------- types ---------------- */

type RawLoginResult = {
  access_token?: string
  user_id?: string
  device_id?: string
  well_known?: any
  accessToken?: string
  userId?: string
  deviceId?: string
}
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

  initPasswordLogin(args: { homeserver: string; user: string; pass: string }): Promise<void>
  finishSsoLoginWithToken(args: { homeserver: string; token: string }): Promise<void>
  startWithAccessToken(args: { homeserver: string; userId: string; accessToken: string; deviceId?: string }): Promise<void>
  logout(): Promise<void>

  paginateBack(roomId: string, batches?: number, limitPerBatch?: number): Promise<number>
  importRoomKeysFromFile(file: File): Promise<void>
  exportRoomKeysToFile(filename?: string): Promise<void>

  ensureRoomEncrypted(roomId: string): Promise<void>
  createEncryptedRoom(name?: string): Promise<string>
  createEncryptedDM(userId: string): Promise<string>

  cryptoEnabled: boolean
  keyBackupEnabled: boolean
}

/* -------------- storage keys -------------- */

const HS_STORAGE_KEY = 'vanish.homeserver'
const SESSION_KEY   = 'vanish.session'

/* ----------------- context ---------------- */

const Ctx = createContext<MatrixCtx | null>(null)

/* ----------------- helpers ---------------- */

const nonEmpty = (x: any): x is string => typeof x === 'string' && x.length > 0
const normHs = (s: string) =>
  s && /^https?:\/\//i.test(s) ? s.trim() : (s ? `https://${s.trim()}` : '')

function normalizeLoginResult(raw: RawLoginResult): LoginResult {
  const userId      = raw.userId      ?? raw.user_id
  const accessToken = raw.accessToken ?? raw.access_token
  const deviceId    = raw.deviceId    ?? raw.device_id
  if (!nonEmpty(userId) || !nonEmpty(accessToken)) {
    throw new Error('SSO/login failed: missing credentials')
  }
  return { userId, accessToken, deviceId, wellKnown: raw.well_known }
}

function roomsArray(c: any): any[] {
  try {
    const rs = typeof c.getVisibleRooms === 'function'
      ? c.getVisibleRooms()
      : (typeof c.getRooms === 'function' ? c.getRooms() : [])
    return Array.isArray(rs) ? rs.filter(Boolean) : []
  } catch {
    return []
  }
}
const lastTs = (r: any) => {
  try {
    if (r?.getLastActiveTs) {
      const t = r.getLastActiveTs()
      return Number.isFinite(t) ? t : 0
    }
    const ev = r?.timeline?.[r.timeline.length - 1]
    const t = ev?.getTs?.() ?? ev?.event?.origin_server_ts
    return Number.isFinite(t) ? t : 0
  } catch { return 0 }
}
const sortRooms = (rs: any[]) => [...rs].sort((a, b) => lastTs(b) - lastTs(a))

function hasCrypto(c: MatrixClient): boolean {
  const anyC: any = c as any
  return !!(anyC.getCrypto?.() || anyC.crypto || anyC.isCryptoEnabled?.())
}

/** Try Rust (WASM) then legacy OLM; tolerate environments without WASM. */
export async function ensureCrypto(client: any): Promise<boolean> {
  try {
    if (client.getCrypto && client.getCrypto()) {
      return true
    }
    if (client.initCrypto) await client.initCrypto()
    if (client.startClient) await client.startClient({ initialSyncLimit: 20 })
    if (client.getCrypto && !client.getCrypto()) {
      await new Promise(res => setTimeout(res, 2000))
    }
    return !!client.getCrypto?.()
  } catch {
    return false
  }
}

/* -------------- provider/hook -------------- */

export function MatrixProvider({ children }: { children: React.ReactNode }) {
  // prep WASM early if present
  useEffect(() => {
    initCryptoEarly().catch(err => console.error('Crypto early init failed', err))
  }, [])

  const [client, setClient] = useState<MatrixClient | null>(null)
  const [ready, setReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [rooms, setRooms] = useState<Room[]>([])
  const [homeserver, setHomeserver] = useState<string | null>(null)
  const [cryptoEnabled, setCryptoEnabled] = useState(false)
  const [keyBackupEnabled, setKeyBackupEnabled] = useState(false)

  const startedRef = useRef(false)

  // keep crypto badge up to date whenever client appears
  useEffect(() => {
    if (!client) return
    let cancelled = false
    ;(async () => {
      const ok = await ensureCrypto(client)
      if (!cancelled) setCryptoEnabled(ok)
    })().catch(e => console.warn('[Vanish] ensureCrypto on client mount failed', e))
    return () => { cancelled = true }
  }, [client])

  /* ---------- bind client & sync/rooms handling ---------- */
  function bindClient(c: MatrixClient) {
    const refresh = () => setRooms(sortRooms(roomsArray(c)) as Room[])
    const markReadyIfRooms = () => {
      if (roomsArray(c).length > 0) setReady(true)
    }

    // Room list refreshers
    c.on('Room', () => { refresh(); markReadyIfRooms() })
    c.on('Room.timeline', () => { refresh() })
    c.on('Room.name', refresh)
    c.on('Room.accountData', refresh)
    c.on('deleteRoom', refresh)
    c.on('Room.receipt', refresh)

    // Sync lifecycle → decide "ready"
    c.on('sync', async (state: string) => {
      if (state === 'PREPARED') {
        setReady(true)
        refresh()
      }
      if ((state === 'SYNCING' || state === 'CATCHUP') && roomsArray(c).length > 0) {
        setReady(true)
      }
      setSyncing(state === 'SYNCING' || state === 'CATCHUP')

      // Update crypto/backup flags opportunistically
      try {
        const has = hasCrypto(c)
        setCryptoEnabled(has)
        if (has && (c as any).isKeyBackupEnabled) {
          const kb = await (c as any).isKeyBackupEnabled()
          setKeyBackupEnabled(!!kb)
        }
      } catch {}
    })
  }

  /* ---------- wait helpers (defensive) ---------- */
  function wait(ms: number) { return new Promise(res => setTimeout(res, ms)) }

  /** Resolve true when any rooms appear OR PREPARED fires; false on timeout. */
  async function waitForFirstRoomsOrPrepared(c: MatrixClient, timeoutMs = 8000): Promise<boolean> {
    const startAt = Date.now()
    return await new Promise<boolean>((resolve) => {
      let done = false
      const finish = (v: boolean) => { if (!done) { done = true; cleanup(); resolve(v) } }

      const check = () => {
        if (roomsArray(c).length > 0) finish(true)
        else if (Date.now() - startAt > timeoutMs) finish(false)
      }

      const onRoom = () => check()
      const onSync = (state: string) => { if (state === 'PREPARED') finish(true) }

      const cleanup = () => {
        c.removeListener('Room', onRoom)
        c.removeListener('sync', onSync as any)
      }

      c.on('Room', onRoom)
      c.on('sync', onSync as any)

      // poll lightly while we wait
      const poll = async () => {
        while (!done) {
          check()
          if (done) break
          await wait(300)
        }
      }
      poll()
    })
  }

  /* ---------- start client w/ stores + fallback ready nudges ---------- */
  async function start(c: MatrixClient) {
    const token = (c as any).getAccessToken?.() ?? (c as any).accessToken
    if (!nonEmpty(token)) {
      console.warn('[Matrix] start() aborted: no access token')
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    // persistent stores (best effort)
    try {
      const { IndexedDBStore } = await import('matrix-js-sdk/lib/store/indexeddb')
      const { IndexedDBCryptoStore } = await import('matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store')
      ;(c as any).store = new IndexedDBStore({ indexedDB: window.indexedDB, dbName: 'vanish-store' })
      await (c as any).store.startup()
      ;(c as any).cryptoStore = new IndexedDBCryptoStore(window.indexedDB, 'vanish-crypto')
    } catch (e) {
      console.warn('[Matrix] IndexedDB stores unavailable; using memory stores.', e)
    }

    // Try crypto now (ok if it falls back)
    const enabled = await ensureCrypto(c)
    setCryptoEnabled(enabled)

    bindClient(c)

    await c.startClient({
      initialSyncLimit: 50,
      lazyLoadMembers: true,
      timelineSupport: true,
    })

    // Strong readiness: wait a bit for either rooms or PREPARED
    const gotRooms = await waitForFirstRoomsOrPrepared(c, 8000)
    if (gotRooms) {
      setReady(true)
      setRooms(sortRooms(roomsArray(c)) as Room[])
    } else {
      // even with 0 rooms, stop showing "Syncing…"
      setReady(true)
      setRooms(sortRooms(roomsArray(c)) as Room[])
    }

    // final nudge after a few seconds (covers odd servers)
    setTimeout(() => {
      try {
        const arr = roomsArray(c)
        setRooms(sortRooms(arr) as Room[])
        if (arr.length > 0) setReady(true)
      } catch {}
    }, 3000)
  }

  /* ---------- login flows ---------- */
  async function initPasswordLogin({ homeserver, user, pass }: {
    homeserver: string; user: string; pass: string
  }) {
    const hs = normHs(homeserver)
    const temp = createClient({ baseUrl: hs })
    const raw = await temp.login('m.login.password', { user, password: pass }) as RawLoginResult
    const res = normalizeLoginResult(raw)

    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: res.userId,
      accessToken: res.accessToken,
      deviceId: res.deviceId
    }))

    const c = createClient({
      baseUrl: hs,
      userId: res.userId,
      accessToken: res.accessToken,
      deviceId: res.deviceId
    })

    setHomeserver(hs)
    setClient(c)

    ensureCrypto(c).then(ok => setCryptoEnabled(ok)).catch(()=>{})
    await start(c)
  }

  async function finishSsoLoginWithToken({ homeserver, token }: { homeserver: string; token: string }) {
    const hs = normHs(homeserver)
    const temp = createClient({ baseUrl: hs })
    const raw = await (temp as any).loginWithToken(token) as RawLoginResult
    const res = normalizeLoginResult(raw)
    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId
    }))
    const c = createClient({ baseUrl: hs, userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId })
    setHomeserver(hs); setClient(c); await start(c)
  }

  async function startWithAccessToken({ homeserver, userId, accessToken, deviceId }: {
    homeserver: string; userId: string; accessToken: string; deviceId?: string
  }) {
    if (!nonEmpty(userId) || !nonEmpty(accessToken)) return
    const hs = normHs(homeserver)
    const c = createClient({ baseUrl: hs, userId, accessToken, deviceId })
    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, accessToken, deviceId }))
    setHomeserver(hs); setClient(c); await start(c)
  }

  async function logout() {
    try { await client?.logout?.() } catch {}
    try { await client?.stopClient?.() } catch {}
    localStorage.removeItem(SESSION_KEY)
    window.location.reload()
  }

  /* ---------- internal helpers ---------- */
  async function maybeInitCrypto() {
    if (!client) throw new Error('No client')
    if (!hasCrypto(client)) {
      const ok = await ensureCrypto(client)
      setCryptoEnabled(ok)
    }
    if (!hasCrypto(client)) throw new Error('Crypto not initialised')
    return (client as any).getCrypto?.() || (client as any).crypto || client
  }

  /* ---------- history ---------- */
  async function paginateBack(roomId: string, batches = 10, limitPerBatch = 50): Promise<number> {
    if (!client) return 0
    const room = client.getRoom(roomId)
    if (!room) return 0
    const tl = room.getLiveTimeline()
    let loaded = 0
    for (let i = 0; i < batches; i++) {
      const more = await client.paginateEventTimeline(tl, { backwards: true, limit: limitPerBatch })
      if (!more) break
      loaded += limitPerBatch
    }
    return loaded
  }

  /* ---------- import/export keys ---------- */
  async function importRoomKeysFromFile(file: File) {
    if (!client) return
    const crypto = await maybeInitCrypto().catch(e => { alert('Import failed: ' + (e?.message ?? String(e))); return null })
    if (!crypto && !(client as any).importRoomKeys) return

    const text = await file.text()

    // Armored export from Element Desktop (not supported by matrix-js-sdk)
    if (/^-{5}BEGIN MEGOLM SESSION DATA-{5}/m.test(text)) {
      alert(
        "This file appears to be the armoured 'BEGIN MEGOLM SESSION DATA' format from Element Desktop.\n\n" +
        "matrix-js-sdk cannot import it directly. Please export keys as JSON in Element, " +
        "or verify this session from Element so keys are shared automatically."
      )
      return
    }

    let parsed: any = null
    try { parsed = JSON.parse(text) } catch {}
    const passphrase = window.prompt('Enter export passphrase (leave empty if none):') || undefined

    const tryPaths: Array<() => Promise<any>> = []
    if ((crypto as any)?.importRoomKeys) {
      tryPaths.push(() => (crypto as any).importRoomKeys(text,   { passphrase }))
      if (parsed) tryPaths.push(() => (crypto as any).importRoomKeys(parsed, { passphrase }))
    }
    if ((client as any).importRoomKeys) {
      tryPaths.push(() => (client as any).importRoomKeys(text,   { passphrase }))
      if (parsed) tryPaths.push(() => (client as any).importRoomKeys(parsed, { passphrase }))
    }

    let lastErr: any = null
    for (const fn of tryPaths) {
      try { await fn(); alert('Keys imported. Click “Load older” to decrypt history.'); return }
      catch (e) { lastErr = e }
    }
    alert('Import failed: ' + (lastErr?.message ?? String(lastErr ?? 'unknown')))
  }

  async function exportRoomKeysToFile(filename = 'vanish-room-keys.json') {
    if (!client) return
    const crypto = await maybeInitCrypto().catch(e => { alert('Export failed: ' + (e?.message ?? String(e))); return null })
    if (!crypto && !(client as any).exportRoomKeys) return

    try {
      const passphrase = window.prompt('Choose a passphrase to encrypt your export (recommended):') || undefined
      const data = (crypto as any)?.exportRoomKeys
        ? await (crypto as any).exportRoomKeys({ passphrase })
        : await (client as any).exportRoomKeys({ passphrase })
      const blob = new Blob([data], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      alert('Export failed: ' + (e?.message ?? String(e)))
    }
  }

  /* ---------- encryption helpers ---------- */
  async function ensureRoomEncrypted(roomId: string) {
    if (!client) throw new Error('No client')
    await maybeInitCrypto()

    const room = client.getRoom(roomId)
    if (!room) throw new Error('Unknown room')
    if (room.isEncrypted?.()) return

    const content = { algorithm: 'm.megolm.v1.aes-sha2' }
    if ((client as any).setRoomEncryption) {
      await (client as any).setRoomEncryption(roomId, content)
    } else {
      await client.sendStateEvent(roomId, 'm.room.encryption', content, '')
    }
  }

  async function createEncryptedRoom(name?: string): Promise<string> {
    if (!client) throw new Error('No client')
    await maybeInitCrypto()
    const res: any = await client.createRoom({
      name,
      preset: 'private_chat',
      initial_state: [
        { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
      ],
    })
    return res.room_id as string
  }

  async function createEncryptedDM(userId: string): Promise<string> {
    if (!client) throw new Error('No client')
    await maybeInitCrypto()
    const res: any = await client.createRoom({
      preset: 'trusted_private_chat',
      is_direct: true,
      invite: [userId],
      initial_state: [
        { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
      ],
    })
    return res.room_id as string
  }

  /* ---------- auto-restore session ---------- */
  useEffect(() => {
    const hs = (localStorage.getItem(HS_STORAGE_KEY) || '').trim()
    const raw = localStorage.getItem(SESSION_KEY)
    if (!hs || !raw) return
    try {
      const s = JSON.parse(raw)
      if (!nonEmpty(s.userId) || !nonEmpty(s.accessToken)) {
        localStorage.removeItem(SESSION_KEY)
        return
      }
      const c = createClient({
        baseUrl: hs,
        userId: s.userId,
        accessToken: s.accessToken,
        deviceId: s.deviceId,
      })
      setHomeserver(hs)
      setClient(c)
      start(c)
    } catch {
      localStorage.removeItem(SESSION_KEY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- ctx value ---------- */
  const value = useMemo<MatrixCtx>(() => ({
    client, ready, syncing, rooms, homeserver,
    initPasswordLogin, finishSsoLoginWithToken, startWithAccessToken, logout,
    paginateBack, importRoomKeysFromFile, exportRoomKeysToFile,
    ensureRoomEncrypted, createEncryptedRoom, createEncryptedDM,
    cryptoEnabled, keyBackupEnabled,
  }), [client, ready, syncing, rooms, homeserver, cryptoEnabled, keyBackupEnabled])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* -------------- hook -------------- */

export function useMatrix(): MatrixCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMatrix must be used within <MatrixProvider>')
  return v
}
