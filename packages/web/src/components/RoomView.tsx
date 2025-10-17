import React, { useEffect, useRef, useState } from 'react'
import { useMatrix } from '../matrix/client'
import { getEffectiveRetentionForRoom, scheduleRetentionGC } from '../matrix/retention'
import RetentionBadge from './RetentionBadge'
import CallButton from './CallButton'

export default function RoomView() {
  const { client, sendText, media } = useMatrix()
  const [roomId, setRoomId] = useState<string | null>(null)
  const [events, setEvents] = useState<any[]>([])
  const [retentionMs, setRetentionMs] = useState<number | undefined>(undefined)
  const [ephemeral, setEphemeral] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => setRoomId((e as CustomEvent<string>).detail)
    window.addEventListener('vanish:set-room', handler as any)
    return () => window.removeEventListener('vanish:set-room', handler as any)
  }, [])

  useEffect(() => {
    if (!client || !roomId) return
    const room = client.getRoom(roomId)
    if (!room) return

    // Retention policy + GC
    getEffectiveRetentionForRoom(client, roomId).then(({ maxLifetime }) => setRetentionMs(maxLifetime))
    scheduleRetentionGC(client, roomId)

    const updateTimeline = () => {
      const tl = room.getLiveTimeline()
      const msgs = tl.getEvents()
        .filter((e:any) => e.getType() === 'm.room.message')
        .map((e:any) => ({ id: e.getId(), sender: e.getSender(), body: e.getContent().body, ts: e.getTs() }))
        .sort((a:any,b:any)=>a.ts-b.ts)
      setEvents(msgs)
    }

    updateTimeline()
    room.on('Room.timeline', updateTimeline)
    return () => { room.removeListener('Room.timeline', updateTimeline) }
  }, [client, roomId])

  const inputRef = useRef<HTMLInputElement>(null)
  const doSend = async () => {
    if (!inputRef.current || !roomId) return
    const text = inputRef.current.value.trim()
    if (!text) return
    await sendText(roomId, text)
    inputRef.current.value = ''
  }

  if (!client || !roomId) return <div className="main"></div>

  return (
    <>
      <header className="header">
        <div>
          <strong>{client.getRoom(roomId)?.name ?? roomId}</strong>
          {' '}<RetentionBadge maxLifetimeMs={retentionMs} ephemeral={ephemeral} />
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <CallButton roomId={roomId} />
          <button className="btn" onClick={()=>{ media.secureWipe(); location.reload() }}>Secure Wipe</button>
          <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" checked={ephemeral} onChange={e=>setEphemeral(e.target.checked)} /> Ephemeral
          </label>
        </div>
      </header>
      <section className="messages">
        {events.map(ev => (
          <div key={ev.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, opacity:.7 }}>{new Date(ev.ts).toLocaleString()} · {ev.sender}</div>
            <div>{ev.body}</div>
          </div>
        ))}
      </section>
      <footer className="input">
        <input ref={inputRef} style={{ flex:1 }} placeholder="Type a message…" />
        <button className="btn" onClick={doSend}>Send</button>
      </footer>
    </>
  )
}
