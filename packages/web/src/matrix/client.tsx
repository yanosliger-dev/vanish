import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { initCryptoEarly } from './cryptoInit'
import { createClient, MatrixClient, Room } from 'matrix-js-sdk'

type RawLoginResult = {
  access_token?: string; user_id?: string; device_id?: string; well_known?: any
  accessToken?: string; userId?: string; deviceId?: string
}
type LoginResult = { accessToken: string; userId: string; deviceId?: string; wellKnown?: any }

type MatrixCtx = {
  client: MatrixClient | null
  ready: boolean
  syncing: boolean
  rooms: Room[]
  homeserver: string | null

  initPasswordLogin(args:{ homeserver:string; user:string; pass:string }): Promise<void>
  finishSsoLoginWithToken(args:{ homeserver:string; token:string }): Promise<void>
  startWithAccessToken(args:{ homeserver:string; userId:string; accessToken:string; deviceId?:string }): Promise<void>
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

const HS_STORAGE_KEY = 'vanish.homeserver'
const SESSION_KEY   = 'vanish.session'

const Ctx = createContext<MatrixCtx | null>(null)

/* ----------------- helpers ----------------- */
const nonEmpty = (x:any): x is string => typeof x === 'string' && x.length>0
const normHs = (s:string) => s && /^https?:\/\//i.test(s) ? s.trim() : (s ? `https://${s.trim()}` : '')

function normalizeLoginResult(raw: RawLoginResult): LoginResult {
  const userId      = raw.userId      ?? raw.user_id
  const accessToken = raw.accessToken ?? raw.access_token
  const deviceId    = raw.deviceId    ?? raw.device_id
  if (!nonEmpty(userId) || !nonEmpty(accessToken)) throw new Error('SSO login failed: missing credentials')
  return { userId, accessToken, deviceId, wellKnown: raw.well_known }
}
function roomsArray(c:any): any[] {
  const rs = typeof c.getVisibleRooms==='function' ? c.getVisibleRooms() : c.getRooms?.() || []
  return Array.isArray(rs) ? rs.filter(Boolean) : []
}
const lastTs = (r:any) => {
  try {
    if (r?.getLastActiveTs) { const t=r.getLastActiveTs(); return Number.isFinite(t)?t:0 }
    const ev = r?.timeline?.[r.timeline.length-1]
    const t = ev?.getTs?.() ?? ev?.event?.origin_server_ts
    return Number.isFinite(t) ? t : 0
  } catch { return 0 }
}
const sortRooms = (rs:any[]) => [...rs].sort((a,b)=>lastTs(b)-lastTs(a))

/* --------------- crypto init --------------- */
function hasCrypto(c: MatrixClient): boolean {
  const anyC: any = c as any
  return !!(anyC.getCrypto?.() || anyC.crypto || anyC.isCryptoEnabled?.())
}

/** Initialise the SDK crypto layer (Rust if available; else legacy OLM). DOES NOT start the client. */
export async function ensureCrypto(client: any): Promise<boolean> {
  try {
    if (hasCrypto(client)) {
      console.log('[Vanish] Crypto already active.')
      return true
    }

    // Prefer Rust crypto if exposed by this build
    if (typeof client.initRustCrypto === 'function') {
      try {
        await import('@matrix-org/matrix-sdk-crypto-wasm')
        console.log('[Vanish] Initialising Rust crypto…')
        await client.initRustCrypto()
        return hasCrypto(client)
      } catch (e) {
        console.warn('[Vanish] Rust crypto unavailable, falling back to legacy OLM.', e)
      }
    }

    // Legacy OLM (asm.js)
    try {
      if (!(window as any).Olm) {
        await import('@matrix-org/olm/olm_legacy.js')
        const Olm = (window as any).Olm
        if (Olm?.init) await Olm.init()
        ;(window as any).Olm = Olm
      }
      if (typeof client.initCrypto === 'function') {
        console.log('[Vanish] Initialising legacy OLM crypto…')
        await client.initCrypto()
      }
    } catch (e) {
      console.error('[Vanish] Legacy OLM init failed', e)
      return false
    }

    // ✅ Use hasCrypto so both Rust + legacy paths are recognised
    return hasCrypto(client)
  } catch (err) {
    console.error('[Vanish] ensureCrypto failed', err)
    return false
  }
}

/* -------------- provider/hook -------------- */
export function MatrixProvider({ children }: { children: React.ReactNode }) {
  // Make Olm/Rust available in the page ASAP
  useEffect(() => {
    initCryptoEarly().catch((err) => console.error('Crypto early init failed', err))
  }, [])

  const [client, setClient] = useState<MatrixClient | null>(null)
  const [ready, setReady]   = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [rooms, setRooms]   = useState<Room[]>([])
  const [homeserver, setHomeserver] = useState<string | null>(null)
  const [cryptoEnabled, setCryptoEnabled] = useState(false)
  const [keyBackupEnabled, setKeyBackupEnabled] = useState(false)

  const startedRef = useRef(false)

  // If a client exists, refresh the crypto badge (safe: does not start client)
  useEffect(() => {
    if (!client) return
    let cancelled = false
    ;(async () => {
      const ok = await ensureCrypto(client)
      if (!cancelled) setCryptoEnabled(ok)
    })().catch((e) => console.warn('[Vanish] ensureCrypto on client mount failed', e))
    return () => { cancelled = true }
  }, [client])

  function bindClient(c: MatrixClient) {
    const refresh = () => setRooms(sortRooms(roomsArray(c)) as Room[])

    c.on('Room', refresh)
    c.on('Room.timeline', refresh)
    c.on('Room.name', refresh)
    c.on('Room.accountData', refresh)
    c.on('deleteRoom', refresh)
    c.on('Room.receipt', refresh)

    c.on('sync', async (state) => {
      if (state === 'PREPARED') {
        setReady(true)
        refresh()
        try {
          const has = hasCrypto(c)
          setCryptoEnabled(has)
          if (has && (c as any).isKeyBackupEnabled) {
            const kb = await (c as any).isKeyBackupEnabled()
            setKeyBackupEnabled(!!kb)
          }
        } catch {}
      }
      setSyncing(state === 'SYNCING' || state === 'CATCHUP')
    })
  }

  async function start(c: MatrixClient) {
    const token = (c as any).getAccessToken?.() ?? (c as any).accessToken
    if (!nonEmpty(token)) { console.warn('[Matrix] start() aborted: no access token'); return }
    if (startedRef.current) return
    startedRef.current = true

    // persistent stores (must exist BEFORE crypto init)
    try {
      const { IndexedDBStore } = await import('matrix-js-sdk/lib/store/indexeddb')
      const { IndexedDBCryptoStore } = await import('matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store')
      ;(c as any).store = new IndexedDBStore({ indexedDB: window.indexedDB, dbName: 'vanish-store' })
      await (c as any).store.startup()
      ;(c as any).cryptoStore = new IndexedDBCryptoStore(window.indexedDB, 'vanish-crypto')
    } catch (e) {
      console.warn('[Matrix] IndexedDB stores unavailable; using memory stores.', e)
    }

    // Init crypto (but DON'T start client here)
    const enabled = await ensureCrypto(c)
    setCryptoEnabled(enabled)

    bindClient(c)

    // Start the client
    await c.startClient({
      initialSyncLimit: 50,
      lazyLoadMembers: true,
      timelineSupport: true,
    })

    // 🟢 NEW: verify crypto state after sync fully begins
    const checkCryptoReady = async (tries = 0): Promise<void> => {
      if (hasCrypto(c)) {
        console.log('[Vanish] Crypto fully active ✓')
        setCryptoEnabled(true)
        return
      }
      if (tries > 10) {
        console.warn('[Vanish] Crypto check timeout — legacy OLM might be slow to report readiness')
        return
      }
      await new Promise(res => setTimeout(res, 500))
      await checkCryptoReady(tries + 1)
    }
    checkCryptoReady()
  }


  // ---------- login flows ----------
  async function initPasswordLogin({ homeserver, user, pass }: {
    homeserver: string
    user: string
    pass: string
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

    await start(c)
  }

  async function finishSsoLoginWithToken({ homeserver, token }:{
    homeserver:string; token:string
  }) {
    const hs = normHs(homeserver)
    const temp = createClient({ baseUrl: hs })
    const raw  = await temp.loginWithToken(token) as RawLoginResult
    const res  = normalizeLoginResult(raw)

    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: res.userId,
      accessToken: res.accessToken,
      deviceId: res.deviceId
    }))

    const c = createClient({ baseUrl: hs, userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId })
    setHomeserver(hs)
    setClient(c)

    await start(c)
  }

  async function startWithAccessToken({ homeserver, userId, accessToken, deviceId }:{
    homeserver:string; userId:string; accessToken:string; deviceId?:string
  }) {
    if (!nonEmpty(userId) || !nonEmpty(accessToken)) return
    const hs = normHs(homeserver)
    const c  = createClient({ baseUrl: hs, userId, accessToken, deviceId })
    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, accessToken, deviceId }))

    setHomeserver(hs)
    setClient(c)

    await start(c)
  }

  async function logout() {
    try { await client?.logout?.() } catch {}
    try { await client?.stopClient?.() } catch {}
    localStorage.removeItem(SESSION_KEY)
    window.location.reload()
  }

  // ---------- internal helpers ----------
  async function maybeInitCrypto() {
    if (!client) throw new Error('No client')
    if (!hasCrypto(client)) {
      const ok = await ensureCrypto(client)
      setCryptoEnabled(ok)
    }
    if (!hasCrypto(client)) throw new Error('Crypto not initialised')
    return (client as any).getCrypto?.() || (client as any).crypto || client
  }

  // ---------- history ----------
  async function paginateBack(roomId: string, batches = 10, limitPerBatch = 50): Promise<number> {
    if (!client) return 0
    const room = client.getRoom(roomId)
    if (!room) return 0
    const tl = room.getLiveTimeline()
    let loaded = 0
    for (let i=0;i<batches;i++) {
      const more = await client.paginateEventTimeline(tl, { backwards: true, limit: limitPerBatch })
      if (!more) break
      loaded += limitPerBatch
    }
    return loaded
  }

  // ---------- import/export ----------
  async function importRoomKeysFromFile(file: File) {
    if (!client) return
    const crypto = await maybeInitCrypto().catch((e)=>{ alert('Import failed: ' + (e?.message ?? String(e))); return null })
    if (!crypto && !(client as any).importRoomKeys) return

    const text = await file.text()

    if (/^-{5}BEGIN MEGOLM SESSION DATA-{5}/m.test(text)) {
      alert(
        "This file is the armoured 'BEGIN MEGOLM SESSION DATA' format.\n\n" +
        "matrix-js-sdk cannot import it directly.\n\n" +
        "Use Element’s “Export E2E room keys” (JSON) and import that here, " +
        "or verify this session from Element to share keys automatically."
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
    const crypto = await maybeInitCrypto().catch((e)=>{ alert('Export failed: ' + (e?.message ?? String(e))); return null })
    if (!crypto && !(client as any).exportRoomKeys) return

    try {
      const passphrase = window.prompt('Choose a passphrase to encrypt your export (recommended):') || undefined
      const data = (crypto as any)?.exportRoomKeys
        ? await (crypto as any).exportRoomKeys({ passphrase })
        : await (client as any).exportRoomKeys({ passphrase })
      const blob = new Blob([data], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href)
    } catch (e:any) { alert('Export failed: ' + (e?.message ?? String(e))) }
  }

  // ---------- E2EE going forward ----------
  async function ensureRoomEncrypted(roomId: string) {
    if (!client) throw new Error('No client')
    await maybeInitCrypto()

    const room = client.getRoom(roomId)
    if (!room) throw new Error('Unknown room')

    if (room.isEncrypted && room.isEncrypted()) return

    if ((client as any).setRoomEncryption) {
      await (client as any).setRoomEncryption(roomId, { algorithm: 'm.megolm.v1.aes-sha2' })
    } else {
      await client.sendStateEvent(roomId, 'm.room.encryption', { algorithm: 'm.megolm.v1.aes-sha2' }, '')
    }
  }

  async function createEncryptedRoom(name?: string): Promise<string> {
    if (!client) throw new Error('No client')
    await maybeInitCrypto()
    const res = await client.createRoom({
      name,
      preset: 'private_chat',
      initial_state: [
        { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
      ],
    })
    return (res as any).room_id as string
  }

  async function createEncryptedDM(userId: string): Promise<string> {
    if (!client) throw new Error('No client')
    await maybeInitCrypto()
    const res = await client.createRoom({
      preset: 'trusted_private_chat',
      is_direct: true,
      invite: [userId],
      initial_state: [
        { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
      ],
    })
    return (res as any).room_id as string
  }

  // ---------- auto-restore session ----------
  useEffect(() => {
    const hs  = normHs(localStorage.getItem(HS_STORAGE_KEY) || '')
    const raw = localStorage.getItem(SESSION_KEY)
    if (!hs || !raw) return
    try {
      const s = JSON.parse(raw)
      if (!nonEmpty(s.userId) || !nonEmpty(s.accessToken)) { localStorage.removeItem(SESSION_KEY); return }
      const c = createClient({ baseUrl: hs, userId: s.userId, accessToken: s.accessToken, deviceId: s.deviceId })
      setHomeserver(hs)
      setClient(c)
      start(c)
    } catch {
      localStorage.removeItem(SESSION_KEY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<MatrixCtx>(() => ({
    client, ready, syncing, rooms, homeserver,
    initPasswordLogin, finishSsoLoginWithToken, startWithAccessToken, logout,
    paginateBack, importRoomKeysFromFile, exportRoomKeysToFile,
    ensureRoomEncrypted, createEncryptedRoom, createEncryptedDM,
    cryptoEnabled, keyBackupEnabled,
  }), [client, ready, syncing, rooms, homeserver, cryptoEnabled, keyBackupEnabled])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMatrix(): MatrixCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMatrix must be used within <MatrixProvider>')
  return v
}
