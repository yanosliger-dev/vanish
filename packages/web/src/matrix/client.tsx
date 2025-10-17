import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as sdk from 'matrix-js-sdk'

const HS = import.meta.env.VITE_MATRIX_HOMESERVER_URL

type Ctx = {
  client?: sdk.MatrixClient,
  initPasswordLogin: (p: { homeserver: string, user: string, pass: string }) => Promise<void>,
  initSSO: (p: { homeserver: string }) => void,
  sendText: (roomId: string, body: string) => Promise<void>,
  media: { secureWipe: () => Promise<void> }
}

const MatrixCtx = createContext<Ctx>({
  initPasswordLogin: async () => {},
  initSSO: () => {},
  sendText: async () => {},
  media: { secureWipe: async () => {} }
})

export function MatrixProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<sdk.MatrixClient>()

  // restore session if present
  useEffect(() => {
    const accessToken = localStorage.getItem('mx_access_token')
    const userId = localStorage.getItem('mx_user_id')
    const deviceId = localStorage.getItem('mx_device_id')
    if (accessToken && userId) {
      const c = sdk.createClient({ baseUrl: HS, accessToken, userId, deviceId })
      c.startClient({ initialSyncLimit: 20 })
      setClient(c)
    }
  }, [])

  async function initPasswordLogin({ homeserver, user, pass }: { homeserver: string, user: string, pass: string }) {
    const c = sdk.createClient({ baseUrl: homeserver })
    const res = await c.login('m.login.password', { user, password: pass })
    const client2 = sdk.createClient({ baseUrl: homeserver, accessToken: res.access_token, userId: res.user_id, deviceId: res.device_id })
    localStorage.setItem('mx_access_token', res.access_token)
    localStorage.setItem('mx_user_id', res.user_id)
    localStorage.setItem('mx_device_id', res.device_id ?? '')
    await client2.startClient({ initialSyncLimit: 20 })
    setClient(client2)
  }

  function initSSO({ homeserver }: { homeserver: string }) {
    const temp = sdk.createClient({ baseUrl: homeserver })
    temp.loginWithRedirect({
      baseUrl: homeserver,
      idpId: undefined,
      redirectUri: window.location.href
    })
  }

  async function sendText(roomId: string, body: string) {
    if (!client) throw new Error('Not ready')
    await client.sendEvent(roomId, 'm.room.message', { msgtype: 'm.text', body })
  }

  async function secureWipe() {
    if (client) {
      try { await client.stopClient() } catch {}
      try { await (client as any).clearStores?.() } catch {}
    }
    localStorage.clear()
    if ('databases' in indexedDB) {
      // @ts-ignore
      const dbs = await indexedDB.databases()
      dbs.forEach((db:any) => db.name && indexedDB.deleteDatabase(db.name))
    }
  }

  const value = useMemo<Ctx>(() => ({ client, initPasswordLogin, initSSO, sendText, media: { secureWipe } }), [client])

  return <MatrixCtx.Provider value={value}>{children}</MatrixCtx.Provider>
}

export function useMatrix() { return useContext(MatrixCtx) }
