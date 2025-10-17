import React from 'react'
import { useMatrix } from '../matrix/client'

export default function CallButton({ roomId }: { roomId: string }) {
  const elementCallBase = import.meta.env.VITE_ELEMENT_CALL_URL // e.g. https://call.example/#/room
  const openCall = () => {
    const url = `${elementCallBase}?matrix_room_id=${encodeURIComponent(roomId)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return <button className="btn" onClick={openCall}>Start / Join Call</button>
}
