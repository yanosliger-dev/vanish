import React from 'react'
import { humanizeDuration } from '../utils/time'

export default function RetentionBadge({ maxLifetimeMs, ephemeral }: { maxLifetimeMs?: number, ephemeral?: boolean }) {
  if (ephemeral) return <span className="badge">Ephemeral (in‑memory only)</span>
  if (!maxLifetimeMs) return <span className="badge">No retention policy</span>
  return <span className="badge">Auto‑clears after {humanizeDuration(maxLifetimeMs)}</span>
}
