import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMatrix } from '../matrix/client'
import type { MatrixEvent, Room } from 'matrix-js-sdk'

type Props = { activeRoomId: string | null }

export default function RoomView({ activeRoomId }: Props) {
  const {
    client, rooms, ready, paginateBack,
    cryptoEnabled, keyBackupEnabled,
    importRoomKeysFromFile, exportRoomKeysToFile,
    restoreBackupWithRecoveryKey, refreshBackupStatus,
  } = useMatrix()

  const room: Room | undefined = useMemo(
    () => rooms.find(r => r.roomId === activeRoomId),
    [rooms, activeRoomId]
  )

  const [events, setEvents] = useState<MatrixEvent[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!client || !room) return
    const refresh = () => setEvents(room.getLiveTimeline().getEvents())
    refresh()
    const onTimeline = (_ev: MatrixEvent, r: Room) => { if (r.roomId === room.roomId) refresh() }
    client.on('Room.timeline', onTimeline)
    client.on('Room.name', refresh)
    client.on('Room.accountData', refresh)
    client.on('Room.receipt', refresh)
    return () => {
      client.removeListener('Room.timeline', onTimeline)
      client.removeListener('Room.name', refresh)
      client.removeListener('Room.accountData', refresh)
      client.removeListener('Room.receipt', refresh)
    }
  }, [client, room])

  async function loadOlder() {
    if (!room) return
    setLoadingOlder(true)
    try {
      const loaded = await paginateBack(room.roomId, 20, 60)
      if (loaded === 0) console.info('No more history (retention/start reached).')
    } finally { setLoadingOlder(false) }
  }

  function renderBody(ev: MatrixEvent): string | null {
    const type = ev.getType()
    const c: any = ev.getContent()

    if (type === 'm.room.encrypted') {
      const failed = (ev as any).isDecryptionFailure?.()
      return failed ? '🔒 Unable to decrypt (import keys / verify another device)' : '🔒 Encrypted…'
    }

    if (type === 'm.room.message') {
      // nice handling of the SDK's "m.bad.encrypted" placeholder
      if (c?.msgtype === 'm.bad.encrypted') return '🔒 Encrypted…'
      if (c?.msgtype === 'm.text' || c?.msgtype === 'm.notice') return c.body ?? ''
      return `[${c?.msgtype ?? 'message'}]`
    }

    if (type === 'm.room.member') return `${c?.membership ?? 'updated membership'}`
    if (type === 'm.room.topic')  return `* set the topic to: ${c?.topic ?? ''}`
    return null
  }

  async function sendMessage() {
    if (!client || !room) return
    const body = (inputRef.current?.value || '').trim()
    if (!body) return
    setSending(true)
    try {
      await client.sendEvent(room.roomId, 'm.room.message', { msgtype:'m.text', body })
      if (inputRef.current) inputRef.current.value = ''
    } finally { setSending(false) }
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  async function handleRestoreFromRecoveryKey() {
    const key = window.prompt('Enter your Security Key (recovery key) to restore backup:')
    if (!key) return
    try {
      await restoreBackupWithRecoveryKey(key.trim())
      await refreshBackupStatus()
      alert('Backup restored. Load older messages to decrypt history.')
    } catch (e:any) {
      alert('Restore failed: ' + (e?.message ?? String(e)))
    }
  }

  if (!ready) return <div className="main"><div className="footer-note">Syncing…</div></div>
  if (!room)  return <div className="main"><div className="footer-note">Select a room</div></div>

  return (
    <div className="main">
      <div className="main-header">
        <strong>{room.name || room.roomId}</strong>
        <button className="btn secondary" onClick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? 'Loading…' : 'Load older'}
        </button>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {cryptoEnabled && (
            <>
              <span className="footer-note">🔐 E2EE {keyBackupEnabled ? '(backup on)' : '(backup off)'}</span>
              <label style={{ cursor:'pointer' }}>
                <span className="btn ghost">Import keys…</span>
                <input type="file" accept="application/json,.json,.txt" style={{ display:'none' }}
                       onChange={e => { const f = e.target.files?.[0]; if (f) importRoomKeysFromFile(f) }} />
              </label>
              <button className="btn ghost" onClick={()=>exportRoomKeysToFile()}>Export keys</button>
              <button className="btn ghost" onClick={handleRestoreFromRecoveryKey}>Restore from recovery key</button>
            </>
          )}
        </div>
      </div>

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
        <textarea ref={inputRef} className="textarea"
                  placeholder="Write a message… (Enter to send, Shift+Enter for newline)"
                  onKeyDown={onKeyDown}/>
        <button className="btn" onClick={sendMessage} disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  )
}
