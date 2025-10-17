import React, { useEffect, useState } from 'react'
import Login from './pages/Login'
import RoomList from './components/RoomList'
import RoomView from './components/RoomView'
import { useMatrix, MatrixProvider } from './matrix/client'

function AppInner() {
  const { client, ready } = useMatrix()
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    if (client && ready) setLoggedIn(true)
  }, [client, ready])

  return loggedIn ? (
    <div className="app">
      <aside className="sidebar"><RoomList /></aside>
      <main className="main"><RoomView /></main>
    </div>
  ) : (
    <Login onLoggedIn={() => setLoggedIn(true)} />
  )
}

export default function App() {
  return (
    <MatrixProvider>
      <AppInner />
    </MatrixProvider>
  )
}
