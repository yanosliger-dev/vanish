// packages/web/src/matrix/client.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createClient,
  MatrixClient,
  Room,
} from 'matrix-js-sdk'

// ---- Types ----
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
  restoreBackupWithRecoveryKey(recoveryKey: string): Promise<void>
  refreshBackupStatus(): Promise<void>

  cryptoEnabled: boolean
  keyBackupEnabled: boolean
}

// ---- Local storage keys ----
const HS_STORAGE_KEY = 'vanish.homeserver'
const SESSION_KEY   = 'vanish.session'

// ---- Context ----
const Ctx = createContext<MatrixCtx | null>(null)

// ---- Helpers ----
const nonEmpty = (x:any): x is string => typeof x === 'string' && x.length>0
function normalizeHs(input: string): string {
  const s = (input || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}
function normalizeLoginResult(raw: RawLoginResult): LoginResult {
  const userId      = raw.userId      ?? raw.user_id
  const accessToken = raw.accessToken ?? raw.access_token
  const deviceId    = raw.deviceId    ?? raw.device_id
  if (!nonEmpty(userId) || !nonEmpty(accessToken)) throw new Error('SSO login failed: missing credentials')
  return { userId, accessToken, deviceId, wellKnown: raw.well_known }
}
function getRoomsArray(c: any): any[] {
  const rs = typeof c.getVisibleRooms === 'function' ? c.getVisibleRooms() : c.getRooms?.() || []
  return Array.isArray(rs) ? rs.filter(Boolean) : []
}
function lastActiveTs(r: any): number {
  try {
    if (r?.getLastActiveTs) {
      const ts = r.getLastActiveTs(); return Number.isFinite(ts) ? ts : 0
    }
    const ev = r?.timeline?.[r.timeline.length-1]
    const ts = (ev?.getTs?.() ?? ev?.event?.origin_server_ts) as number|undefined
    return Number.isFinite(ts) ? (ts as number) : 0
  } catch { return 0 }
}
function sortRoomsSafe(rs: any[]): any[] {
  return [...rs].sort((a,b)=> lastActiveTs(b) - lastActiveTs(a))
}
async function replaceAndStart(
  hs: string,
  creds: { userId:string; accessToken:string; deviceId?:string },
  setHomeserver: (s:string)=>void,
  setClient: (c:MatrixClient)=>void,
  start: (c:MatrixClient)=>Promise<void>,
) {
  const newClient = createClient({
    baseUrl: hs,
    userId: creds.userId,
    accessToken: creds.accessToken,
    deviceId: creds.deviceId,
  })
  setHomeserver(hs)
  setClient(newClient)
  await start(newClient)
}

// Ensure crypto (Rust preferred; Olm fallback). Returns true if enabled.
async function ensureCrypto(client: MatrixClient): Promise<boolean> {
  // Prefer Rust Crypto (WASM)
  try {
    // Ensure wasm package is bundled; matrix-js-sdk will load it from here.
    await import('@matrix-org/matrix-sdk-crypto-wasm')
    if ((client as any).initRustCrypto) {
      await (client as any).initRustCrypto()
      return !!(client as any).getCrypto?.()
    }
  } catch {
    // fall through to JS Olm
  }

  // Fallback: JS Olm
  try {
    const OlmMod: any = await import('@matrix-org/olm')
    const Olm = (OlmMod && (OlmMod.default || OlmMod)) || OlmMod
    if (Olm?.init) await Olm.init()
    ;(window as any).Olm = Olm
    if ((client as any).initCrypto) {
      await (client as any).initCrypto()
      return !!(client as any).getCrypto?.()
    }
  } catch (e) {
    console.warn('[Matrix] Olm fallback failed', e)
  }
  return false
}

// ---- Provider / Hook ----
export function MatrixProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<MatrixClient | null>(null)
  const [ready, setReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [rooms, setRooms] = useState<Room[]>([])
  const [homeserver, setHomeserver] = useState<string | null>(null)
  const [cryptoEnabled, setCryptoEnabled] = useState(false)
  const [keyBackupEnabled, setKeyBackupEnabled] = useState(false)

  const startedRef = useRef(false)

  function bindClient(c: MatrixClient) {
    const refresh = () => {
      const rs = getRoomsArray(c)
      setRooms(sortRoomsSafe(rs) as Room[])
    }

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
          const hasCrypto = !!(c as any).getCrypto?.()
          setCryptoEnabled(hasCrypto)
          if (hasCrypto && (c as any).isKeyBackupEnabled) {
            const kb = await (c as any).isKeyBackupEnabled()
            setKeyBackupEnabled(!!kb)
          }
        } catch {/* ignore */}
      }
      setSyncing(state === 'SYNCING' || state === 'CATCHUP')
    })
  }

  async function start(c: MatrixClient) {
    const token = (c as any).getAccessToken?.() ?? (c as any).accessToken
    if (!nonEmpty(token)) {
      console.warn('[Matrix] start() aborted: no access token on client')
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    // Persistent stores (history + crypto across reloads)
    try {
      const { IndexedDBStore } = await import('matrix-js-sdk/lib/store/indexeddb')
      const { IndexedDBCryptoStore } = await import('matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store')
      ;(c as any).store = new IndexedDBStore({ indexedDB: window.indexedDB, dbName: 'vanish-store' })
      await (c as any).store.startup()
      ;(c as any).cryptoStore = new IndexedDBCryptoStore(window.indexedDB, 'vanish-crypto')
    } catch (e) {
      console.warn('[Matrix] IndexedDB stores unavailable, continuing in-memory.', e)
    }

    // Enable crypto BEFORE startClient
    const enabled = await ensureCrypto(c)
    setCryptoEnabled(enabled)

    bindClient(c)

    await c.startClient({
      initialSyncLimit: 50,
      lazyLoadMembers: true,
      timelineSupport: true,
    })
  }

  // ---- Login flows ----
  async function initPasswordLogin({ homeserver, user, pass }:{
    homeserver:string; user:string; pass:string
  }) {
    const hs = normalizeHs(homeserver)
    const temp = createClient({ baseUrl: hs })
    const raw = await temp.login('m.login.password', { user, password: pass }) as RawLoginResult
    const res = normalizeLoginResult(raw)

    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId }))
    await replaceAndStart(hs, { userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId }, setHomeserver, setClient, start)
  }

  async function finishSsoLoginWithToken({ homeserver, token }:{
    homeserver:string; token:string
  }) {
    const hs = normalizeHs(homeserver)
    const temp = createClient({ baseUrl: hs })
    const raw = await temp.loginWithToken(token) as RawLoginResult
    const res = normalizeLoginResult(raw)

    localStorage.setItem(HS_STORAGE_KEY, hs)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId }))
    await replaceAndStart(hs, { userId: res.userId, accessToken: res.accessToken, deviceId: res.deviceId }, setHomeserver, setClient, start)
  }

  async function startWithAccessToken({ homeserver, userId, accessToken, deviceId }:{
    homeserver:string; userId:string; accessToken:string; deviceId?:string
  }) {
    if (!nonEmpty(userId) || !nonEmpty(accessToken)) return
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
    setClient(null); setRooms([]); setReady(false); setSyncing(false)
    startedRef.current = false
    localStorage.removeItem(SESSION_KEY)
  }

  // ---- History & crypto helpers ----
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

  async function importRoomKeysFromFile(file: File) {
    if (!client) return
    const crypto: any = (client as any).getCrypto?.()
    if (!crypto && !(client as any).importRoomKeys) {
      alert('Import failed: End-to-end encryption disabled')
      return
    }
    const text = await file.text()
    const passphrase = window.prompt('If the export was protected, enter its passphrase (or leave empty):') || undefined
    try {
      if (crypto?.importRoomKeys) {
        await crypto.importRoomKeys(text, { passphrase })
      } else {
        // legacy on MatrixClient
        await (client as any).importRoomKeys(text, { passphrase })
      }
      alert('Keys imported. Load older messages to decrypt history.')
    } catch (e:any) {
      alert('Import failed: ' + (e?.message ?? String(e)))
    }
  }

  async function exportRoomKeysToFile(filename = 'vanish-room-keys.json') {
    if (!client) return
    const crypto: any = (client as any).getCrypto?.()
    if (!crypto && !(client as any).exportRoomKeys) {
      alert('Export failed: End-to-end encryption disabled')
      return
    }
    try {
      const passphrase = window.prompt('Choose a passphrase to encrypt your export (recommended):') || undefined
      const data = crypto?.exportRoomKeys
        ? await crypto.exportRoomKeys({ passphrase })
        : await (client as any).exportRoomKeys({ passphrase })
      const blob = new Blob([data], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e:any) {
      alert('Export failed: ' + (e?.message ?? String(e)))
    }
  }

  async function restoreBackupWithRecoveryKey(recoveryKey: string) {
    if (!client) throw new Error('No client')
    const crypto: any = (client as any).getCrypto?.()
    if (!crypto) throw new Error('Crypto not initialised')

    const version = await crypto.getKeyBackupVersion?.()
    if (!version) throw new Error('No key backup found on server')

    if (crypto.restoreKeyBackupWithRecoveryKey) {
      await crypto.restoreKeyBackupWithRecoveryKey(recoveryKey, undefined, version)
    } else if (crypto.restoreKeyBackupWithSecretStorageKey) {
      await crypto.restoreKeyBackupWithSecretStorageKey(recoveryKey, undefined, version)
    } else {
      throw new Error('This SDK build does not expose key-backup restore API')
    }

    if (crypto.isKeyBackupEnabled) {
      const kb = await crypto.isKeyBackupEnabled()
      setKeyBackupEnabled(!!kb)
    }
  }

  async function refreshBackupStatus() {
    if (!client) return
    const crypto: any = (client as any).getCrypto?.()
    if (!crypto) { setKeyBackupEnabled(false); return }
    try {
      const kb = await crypto.isKeyBackupEnabled?.()
      setKeyBackupEnabled(!!kb)
    } catch { /* ignore */ }
  }

  // ---- Auto-restore session on mount ----
  useEffect(() => {
    const hs  = normalizeHs(localStorage.getItem(HS_STORAGE_KEY) || '')
    const raw = localStorage.getItem(SESSION_KEY)
    if (!hs || !raw) return
    try {
      const s = JSON.parse(raw)
      if (!nonEmpty(s.userId) || !nonEmpty(s.accessToken)) {
        localStorage.removeItem(SESSION_KEY); return
      }
      setHomeserver(hs)
      startWithAccessToken({ homeserver: hs, userId: s.userId, accessToken: s.accessToken, deviceId: s.deviceId })
    } catch {
      localStorage.removeItem(SESSION_KEY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<MatrixCtx>(() => ({
    client, ready, syncing, rooms, homeserver,
    initPasswordLogin, finishSsoLoginWithToken, startWithAccessToken, logout,
    paginateBack, importRoomKeysFromFile, exportRoomKeysToFile,
    restoreBackupWithRecoveryKey, refreshBackupStatus,
    cryptoEnabled, keyBackupEnabled,
  }), [client, ready, syncing, rooms, homeserver, cryptoEnabled, keyBackupEnabled])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMatrix(): MatrixCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMatrix must be used within <MatrixProvider>')
  return v
}
