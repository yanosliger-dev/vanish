// Placeholder for a simple media store with purge capability
export async function purgeBefore(_cutoffMs: number) {
  // Implement IndexedDB or CacheStorage-based media blobs and delete where ts < cutoffMs
}
