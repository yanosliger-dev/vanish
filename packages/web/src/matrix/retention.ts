import type { MatrixClient } from 'matrix-js-sdk'
import type { RetentionPolicy } from './types'

// Parse m.room.retention state and compute effective max lifetime (ms)
export async function getEffectiveRetentionForRoom(client: MatrixClient, roomId: string): Promise<{ minLifetime?: number, maxLifetime?: number }> {
  const ev = client.getRoom(roomId)?.currentState.getStateEvents('m.room.retention', '')
  const content = (ev?.getContent?.() ?? {}) as RetentionPolicy
  const minLifetime = normMs(content.min_lifetime)
  const maxLifetime = normMs(content.max_lifetime)
  return { minLifetime, maxLifetime }
}

function normMs(v?: number) {
  if (v == null) return undefined
  // Heuristic: if it's tiny (<60k) assume seconds and upcast to ms.
  if (v > 0 && v < 60_000) return v * 1000
  return v
}

// Schedule periodic local GC for a room based on retention
const scheduled = new Set<string>()
export function scheduleRetentionGC(client: MatrixClient, roomId: string) {
  if (scheduled.has(roomId)) return
  scheduled.add(roomId)

  const run = async () => {
    const { maxLifetime } = await getEffectiveRetentionForRoom(client, roomId)
    if (!maxLifetime) return // nothing to do
    const cutoff = Date.now() - maxLifetime

    const room = client.getRoom(roomId)
    if (!room) return
    const tl = room.getLiveTimeline()
    const evs = tl.getEvents()
    const toHide = evs.filter((e:any) => e.getTs() < cutoff)

    // Mark as locally redacted (UI prune). For MVP we avoid deep IndexedDB surgery.
    toHide.forEach((e:any) => {
      try { e.event.redacted_because = { local_retain_prune: true } } catch {}
    })
    // TODO: hook mediaStore.purgeBefore(cutoff)
  }

  run()
  const id = setInterval(run, 60_000 * 60) // hourly
  // NOTE: track id if you want to clear it on logout
}
