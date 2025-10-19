// src/App.tsx
import React, { useEffect, useState } from 'react'
import Login from './components/Login'
import RoomList from './components/RoomList'
import RoomView from './components/RoomView'
import { MatrixProvider } from './matrix/client'

function hasSession() {
  // Primary (our provider):
  if (localStorage.getItem('vanish.session')) return true
  // Fallback (older logic):
  if (localStorage.getItem('mx_access_token')) return true
  return false
}

function Shell() {
  // Parse #/room/<roomId> and pass to RoomView
  const parseHash = () => {
    const m = window.location.hash.match(/#\/room\/([^?#]+)/)
    return m?.[1] ? decodeURIComponent(m[1]) : null
  }
  const [activeRoomId, setActiveRoomId] = useState<string | null>(parseHash())

  useEffect(() => {
    const onHash = () => setActiveRoomId(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app">
      <aside className="sidebar"><RoomList /></aside>
      <main className="main"><RoomView activeRoomId={activeRoomId} /></main>
    </div>
  )
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState<boolean>(hasSession())

  // Keep gate in sync if another tab logs in/out or after Login writes storage
  useEffect(() => {
    const onStorage = () => setLoggedIn(hasSession())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const onLoggedIn = () => setLoggedIn(true)

  return (
    <MatrixProvider>
      {loggedIn ? <Shell /> : <Login onLoggedIn={onLoggedIn} />}
    </MatrixProvider>
  )
}
