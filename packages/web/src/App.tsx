import React, { useState } from 'react'
import Login from './components/Login'
import RoomList from './components/RoomList'
import RoomView from './components/RoomView'
import { MatrixProvider } from './matrix/client'

export default function App() {
  const [loggedIn, setLoggedIn] = useState(
    Boolean(localStorage.getItem('mx_access_token'))
  )

  const onLoggedIn = () => setLoggedIn(true)

  return (
    <MatrixProvider>
      {loggedIn ? (
        <div className="app">
          <aside className="sidebar"><RoomList /></aside>
          <main className="main"><RoomView /></main>
        </div>
      ) : (
        <Login onLoggedIn={onLoggedIn} />
      )}
    </MatrixProvider>
  )
}
