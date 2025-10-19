import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMatrix } from '../matrix/client'
import type { MatrixEvent, Room } from 'matrix-js-sdk'

type Props = { activeRoomId: string | null }

export default function RoomView({ activeRoomId }: Props) {
  const {
    client, rooms, ready, paginateBack,
    cryptoEnabled, keyBackupEnabled,
    importRoomKeysFromFile, exportRoomKeysToFile,
    ensureRoomEncrypted,
    logout,
  } = useMatrix()

  // Select room from rooms list
  const room: Room | undefined = useMemo(
    () => rooms.find(r => r.roomId === activeRoomId),
    [rooms, activeRoomId]
  )

  // Bind to SDK room (handles delay before rooms[] populates)
  const [boundRoom, setBoundRoom] = useState<Room | undefined>(room)

  useEffect(() => {
    let cancel = false
    if (room) { setBoundRoom(room); return }
    async function waitForRoom(ms = 8000) {
      if (!client || !activeRoomId) return
      const step = 200
      for (let t = 0; t < ms && !cancel; t += step) {
        const r = client.getRoom(activeRoomId)
        if (r) { setBoundRoom(r); return }
        await new Promise(res => setTimeout(res, step))
      }
    }
    if (!room && client && activeRoomId) waitForRoom()
    return () => { cancel = true }
  }, [client, room, activeRoomId])

  // -------------------------- State --------------------------
  const [events, setEvents] = useState<MatrixEvent[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [encrypting, setEncrypting] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isEncrypted = boundRoom?.isEncrypted && boundRoom.isEncrypted()

  // -------------------------- Bind events --------------------------
  useEffect(() => {
    if (!client || !boundRoom) return
    const refresh = () => setEvents(boundRoom.getLiveTimeline().getEvents())
    refresh()

    const onTimeline = (_ev: MatrixEvent, r: Room) => {
      if (r.roomId === boundRoom.roomId) refresh()
    }

    // 🔄 New: also refresh when room state changes (e.g., encryption enabled)
    const onRoomState = () => {
      refresh()
    }

    client.on('Room.timeline', onTimeline)
    client.on('Room.name', refresh)
    client.on('Room.accountData', refresh)
    client.on('Room.receipt', refresh)
    boundRoom.on('RoomState.events', onRoomState)

    return () => {
      client.removeListener('Room.timeline', onTimeline)
      client.removeListener('Room.name', refresh)
      client.removeListener('Room.accountData', refresh)
      client.removeListener('Room.receipt', refresh)
      boundRoom.removeListener('RoomState.events', onRoomState)
    }
  }, [client, boundRoom])

  // -------------------------- Load older --------------------------
  async function loadOlder() {
    if (!boundRoom) return
    setLoadingOlder(true)
    try {
      const loaded = await paginateBack(boundRoom.roomId, 20, 60)
      if (loaded === 0) console.info('No more history (retention/start reached).')
    } finally { setLoadingOlder(false) }
  }

  // -------------------------- Render body --------------------------
  function renderBody(ev: MatrixEvent): string | null {
    const type = ev.getType()
    const c: any = ev.getContent()

    if (type === 'm.room.encrypted') {
      const failed = (ev as any).isDecryptionFailure?.()
      return failed ? '🔒 Unable to decrypt (missing keys)' : '🔒 Encrypted…'
    }

    if (type === 'm.room.message') {
      if (c?.msgtype === 'm.bad.encrypted') return '🔒 Encrypted…'
      if (c?.msgtype === 'm.text' || c?.msgtype === 'm.notice') return c.body ?? ''
      return `[${c?.msgtype ?? 'message'}]`
    }

    if (type === 'm.room.member') return `${c?.membership ?? 'updated membership'}`
    if (type === 'm.room.topic') return `* set the topic to: ${c?.topic ?? ''}`
    return null
  }

  // -------------------------- Encrypt room --------------------------
  async function encryptRoomNow() {
    if (!boundRoom) return
    setEncrypting(true)
    try {
      await ensureRoomEncrypted(boundRoom.roomId)
      // force-refresh banner instantly
      setTimeout(() => setEvents(boundRoom.getLiveTimeline().getEvents()), 200)
      alert('Room encryption enabled. New messages will be end-to-end encrypted.')
    } catch (e: any) {
      alert('Failed to enable encryption: ' + (e?.message ?? String(e)))
    } finally {
      setEncrypting(false)
    }
  }

  // -------------------------- Send message --------------------------
  async function sendMessage() {
    if (!client || !boundRoom) return
    if (!boundRoom.isEncrypted?.() && !confirm('This room is not encrypted. Encrypt it now?')) {
      return
    }
    if (!boundRoom.isEncrypted?.()) {
      await encryptRoomNow()
      if (!boundRoom.isEncrypted?.()) return
    }

    const body = (inputRef.current?.value || '').trim()
    if (!body) return
    setSending(true)
    try {
      await client.sendEvent(boundRoom.roomId, 'm.room.message', { msgtype: 'm.text', body })
      if (inputRef.current) inputRef.current.value = ''
    } finally { setSending(false) }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // -------------------------- Render states --------------------------
  if (!ready) return <div className="main"><div className="footer-note">Syncing…</div></div>
  if (!activeRoomId) return <div className="main"><div className="footer-note">Select a room</div></div>
  if (!boundRoom) return <div className="main"><div className="footer-note">Preparing room…</div></div>

  // -------------------------- UI --------------------------
  return (
    <div className="main">
      <div className="main-header">
        <strong>{boundRoom.name || boundRoom.roomId}</strong>
        <button className="btn secondary" onClick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? 'Loading…' : 'Load older'}
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="footer-note">
            {isEncrypted ? '🔐 Encrypted' : '⚠️ Not encrypted'}
            {' '}· Crypto {cryptoEnabled ? 'on' : 'off'}
          </span>

          {!isEncrypted && (
            <button className="btn ghost" onClick={encryptRoomNow} disabled={encrypting}>
              {encrypting ? 'Enabling…' : 'Encrypt this room'}
            </button>
          )}

          <label style={{ cursor: 'pointer' }}>
            <span className="btn ghost">Import keys…</span>
            <input
              type="file"
              accept="application/json,.json,.txt"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) importRoomKeysFromFile(f)
              }}
            />
          </label>

          <button className="btn ghost" onClick={() => exportRoomKeysToFile()}>Export keys</button>
          <button className="btn" onClick={logout}>Log out</button>
        </div>
      </div>

      {!isEncrypted && (
        <div style={{
          margin: '8px 0',
          padding: 10,
          borderRadius: 12,
          background: 'rgba(255,200,0,0.08)',
          border: '1px solid rgba(255,200,0,0.25)'
        }}>
          This room is not encrypted. Click <b>Encrypt this room</b> to enable end-to-end encryption (Megolm) for all new messages.
        </div>
      )}

      <div className="timeline">
        {events.map(ev => {
          const body = renderBody(ev)
          if (!body) return null
          const sender = ev.getSender()
          const ts = new Date(ev.getTs()).toLocaleString()
          return (
            <div key={ev.getId() || `${ev.getType()}-${ev.getTs()}-${Math.random()}`} className="event">
              <div className="event-meta">{sender} — {ts}</div>
              <div>{body}</div>
            </div>
          )
        })}
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          className="textarea"
          placeholder="Write a message… (Enter to send, Shift+Enter for newline)"
          onKeyDown={onKeyDown}
        />
        <button className="btn" onClick={sendMessage} disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
