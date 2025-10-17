export function humanizeDuration(ms?: number) {
  if (!ms) return 'unknown time'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  if (d >= 1) return `${d} day${d===1?'':'s'}`
  const h = Math.floor((s % 86400) / 3600)
  if (h >= 1) return `${h} hour${h===1?'':'s'}`
  const m = Math.floor((s % 3600) / 60)
  if (m >= 1) return `${m} minute${m===1?'':'s'}`
  return `${s} second${s===1?'':'s'}`
}
