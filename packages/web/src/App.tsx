import React, { useEffect, useMemo, useState } from 'react'
import Login from './components/Login'
import RoomList from './components/RoomList'
import RoomView from './components/RoomView'
import { MatrixProvider } from './matrix/client'
import { useMatrix } from './matrix/client'

function useActiveRoomIdFromHash(roomsReady: boolean) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)

  // Parse #/room/<roomId>
  const parseHash = () => {
    const h = location.hash || ''
    const part = decodeURIComponent((h.split('/room/')[1] || '').split(/[?#]/)[0] || '')
    setActiveRoomId(part || null)
  }

  useEffect(() => {
    parseHash()
    const onHash = () => parseHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // If we don't have a room in the hash when rooms are ready, keep it null.
  // RoomList will highlight none; the user can click one.
  useEffect(() => {
    if (roomsReady && !location.hash.includes('/room/')) {
      // leave as null; clicking a room will set the hash
    }
  }, [roomsReady])

  return [activeRoomId, setActiveRoomId] as const
}

function Shell() {
  const [loggedIn, setLoggedIn] = useState(
    Boolean(localStorage.getItem('mx_access_token')) // your original gate
  )
  const onLoggedIn = () => setLoggedIn(true)

  // We need ready flag to know when rooms list is populated
  const { ready } = useMatrix()
  const [activeRoomId] = useActiveRoomIdFromHash(ready)

  return (
    <div className="app">
      <aside className="sidebar"><RoomList activeRoomId={activeRoomId} /></aside>
      <main className="main"><RoomView activeRoomId={activeRoomId} /></main>
    </div>
  )
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(
    Boolean(localStorage.getItem('mx_access_token'))
  )
  const onLoggedIn = () => setLoggedIn(true)

  return (
    <MatrixProvider>
      {loggedIn ? <Shell /> : <Login onLoggedIn={onLoggedIn} />}
    </MatrixProvider>
  )
}
