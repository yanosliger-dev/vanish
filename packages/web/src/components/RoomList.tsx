import React, { useMemo, useState } from 'react'
import { useMatrix } from '../matrix/client'

type Props = { activeRoomId: string | null; onSelect: (roomId: string) => void }

export default function RoomList({ activeRoomId, onSelect }: Props) {
  const { rooms, ready } = useMatrix()
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const base = rooms
    if (!needle) return base
    return base.filter(r => (r.name || r.roomId).toLowerCase().includes(needle))
  }, [rooms, q])

  return (
    <div className="sidebar">
      <div className="side-header">
        <div className="brand">{import.meta.env.VITE_APP_NAME || 'Vanish'}</div>
      </div>

      <div className="search">
        <input className="input" placeholder="Search rooms…" value={q} onChange={e=>setQ(e.target.value)} />
      </div>

      <div className="room-list">
        {!ready && <div className="footer-note">Syncing…</div>}
        {ready && filtered.length === 0 && <div className="footer-note">No rooms.</div>}
        {filtered.map(r => {
          const lastTs = new Date((r as any).getLastActiveTs?.() || 0).toLocaleString()
          const encrypted = r.isEncrypted && r.isEncrypted()
          return (
            <div key={r.roomId}
                 className={`room ${activeRoomId === r.roomId ? 'active' : ''}`}
                 onClick={()=>onSelect(r.roomId)} title={r.name || r.roomId}>
              <div className="room-title">{encrypted ? '🔐 ' : ''}{r.name || r.roomId}</div>
              <div className="room-meta"><span>{lastTs !== 'Invalid Date' ? lastTs : '—'}</span></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
