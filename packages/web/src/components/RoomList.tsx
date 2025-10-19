import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMatrix } from '../matrix/client'
import type { Room } from 'matrix-js-sdk'

/** Parse active room id from hash like #/room/<roomId> (fallback: empty) */
function getActiveFromHash(): string {
  // capture after /room/ up to a ? or # or end; decode to support special chars
  const m = window.location.hash.match(/#\/room\/([^?#]+)/)
  return m?.[1] ? decodeURIComponent(m[1]) : ''
}

export default function RoomList() {
  const {
    rooms,
    client,
    createEncryptedDM,
    createEncryptedRoom,
  } = useMatrix()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string>(getActiveFromHash())
  const activeRef = useRef<HTMLDivElement | null>(null)

  // keep selection in sync with URL hash (works with RoomView implementations that read the hash)
  useEffect(() => {
    const onHash = () => setActive(getActiveFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // If hash points to a room we don't have (yet) and we do have rooms, select the first one.
  useEffect(() => {
    if (!rooms.length) return
    const found = active && rooms.some(r => r.roomId === active)
    if (!active || !found) {
      const first = rooms[0].roomId
      setActive(first)
      window.location.hash = `#/room/${encodeURIComponent(first)}`
    }
  }, [active, rooms])

  const filtered: Room[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rooms
    return rooms.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      r.roomId.toLowerCase().includes(q)
    )
  }, [rooms, query])

  function selectRoom(roomId: string) {
    setActive(roomId)
    // hash helps RoomView implementations that rely on location
    window.location.hash = `#/room/${encodeURIComponent(roomId)}`
  }

  async function onNewDM() {
    const userId = window.prompt('Start encrypted DM with user (e.g. @alice:your-hs.tld):')
    if (!userId) return
    if (!/^@.+:.+/.test(userId)) { alert('Please enter a valid Matrix userId, e.g. @name:server'); return }
    try {
      const roomId = await createEncryptedDM(userId.trim())
      // join (defensive: createRoom already joins you, but just in case)
      await client?.joinRoom?.(roomId).catch(()=>{})
      selectRoom(roomId)
    } catch (e:any) {
      alert('Failed to create DM: ' + (e?.message ?? String(e)))
    }
  }

  async function onNewRoom() {
    const name = window.prompt('Encrypted room name (optional):') || undefined
    try {
      const roomId = await createEncryptedRoom(name)
      await client?.joinRoom?.(roomId).catch(()=>{})
      selectRoom(roomId)
    } catch (e:any) {
      alert('Failed to create room: ' + (e?.message ?? String(e)))
    }
  }

  // smooth UX: keep the selected item visible after list/filter changes
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [active, filtered.length])

  return (
    <div className="sidebar-inner" style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ display:'flex', gap:8, margin:'8px 8px 6px 8px' }}>
        <button className="btn" onClick={onNewDM} title="New encrypted DM">New chat</button>
        <button className="btn secondary" onClick={onNewRoom} title="New encrypted room">New room</button>
      </div>

      <input
        className="input"
        style={{ margin: '0 8px 8px 8px' }}
        placeholder="Search rooms…"
        value={query}
        onChange={e=>setQuery(e.target.value)}
      />

      <div style={{ overflow:'auto', padding:'0 6px 8px 6px' }}>
        {filtered.map(r => {
          const isActive = r.roomId === active
          return (
            <div
              key={r.roomId}
              ref={isActive ? activeRef : null}
              className="room-list-item"
              onClick={() => selectRoom(r.roomId)}
              style={{
                padding:'10px 12px',
                borderRadius:12,
                cursor:'pointer',
                margin:'4px 2px',
                background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: isActive ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
              }}
              title={r.roomId}
            >
              <div style={{ fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {r.name || r.roomId}
              </div>
              <div style={{ fontSize:12, opacity:0.6 }}>
                {r.isEncrypted?.() ? '🔐 Encrypted' : '⚠️ Not encrypted'}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ opacity: 0.6, padding: '8px 10px' }}>No rooms</div>
        )}
      </div>
    </div>
  )
}
