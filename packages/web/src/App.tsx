import React, { useEffect, useState } from 'react'
import Login from './pages/Login'              // ⬅️ now from pages/
import RoomList from './components/RoomList'
import RoomView from './components/RoomView'
import { useMatrix, MatrixProvider } from './matrix/client'

function AppInner() {
  const { client, ready } = useMatrix()
  const [loggedIn, setLoggedIn] = useState(false)

  // When client becomes available and ready (after login or restored session)
  useEffect(() => {
    if (client && ready) setLoggedIn(true)
  }, [client, ready])

  const onLoggedIn = () => setLoggedIn(true)

  return loggedIn ? (
    <div className="app">
      <aside className="sidebar">
        <RoomList />
      </aside>
      <main className="main">
        <RoomView />
      </main>
    </div>
  ) : (
    <Login onLoggedIn={onLoggedIn} />
  )
}

export default function App() {
  return (
    <MatrixProvider>
      <AppInner />
    </MatrixProvider>
  )
}
