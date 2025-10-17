import React, { useEffect, useState } from 'react'
import { useMatrix } from '../matrix/client'

export default function RoomList() {
  const { client } = useMatrix()
  const [rooms, setRooms] = useState<any[]>([])

  useEffect(() => {
    if (!client) return
    const update = () => setRooms(client.getVisibleRooms().sort((a:any,b:any)=>a.name.localeCompare(b.name)))
    update()
    client.on('Room', update)
    client.on('Room.name', update)
    return () => { client.removeListener('Room', update); client.removeListener('Room.name', update) }
  }, [client])

  return (
    <div>
      <h3>Rooms</h3>
      <ul style={{ listStyle:'none', padding:0 }}>
        {rooms.map((r:any) => (
          <li key={r.roomId}>
            <button className="btn" style={{ width:'100%', textAlign:'left', marginBottom:6 }}
              onClick={() => window.dispatchEvent(new CustomEvent('vanish:set-room', { detail: r.roomId }))}>
              {r.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
