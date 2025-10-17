import React from 'react'
import { useMatrix } from '../matrix/client'

export default function RoomsPane() {
  const { ready, syncing, rooms } = useMatrix()

  if (!ready) {
    return <div style={{ padding: 12 }}>Syncing… {syncing ? '(live)' : ''}</div>
  }

  if (!rooms.length) {
    return <div style={{ padding: 12 }}>No rooms found. Join or create one!</div>
  }

  return (
    <div style={{ padding: 12 }}>
      <h2>Rooms</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rooms.map(r => (
          <li key={r.roomId} style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}>
            <div style={{ fontWeight: 600 }}>{r.name || r.roomId}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {new Date(r.getLastActiveTs() || 0).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
