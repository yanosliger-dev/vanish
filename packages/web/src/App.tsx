import React, { useEffect, useState } from 'react'
import RoomList from './components/RoomList'
import RoomView from './components/RoomView'
import Login from './pages/Login'
import { useMatrix, MatrixProvider } from './matrix/client'

function Shell() {
  const { client, ready, rooms } = useMatrix()
  const [loggedIn, setLoggedIn] = useState(false)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)

  useEffect(() => { if (client && ready) setLoggedIn(true) }, [client, ready])
  useEffect(() => { if (!activeRoomId && rooms.length) setActiveRoomId(rooms[0].roomId) }, [rooms, activeRoomId])

  return loggedIn ? (
    <div className="app">
      <RoomList activeRoomId={activeRoomId} onSelect={setActiveRoomId} />
      <RoomView activeRoomId={activeRoomId} />
    </div>
  ) : (
    <Login onLoggedIn={() => setLoggedIn(true)} />
  )
}

export default function App() {
  return (
    <MatrixProvider>
      <Shell />
    </MatrixProvider>
  )
}
