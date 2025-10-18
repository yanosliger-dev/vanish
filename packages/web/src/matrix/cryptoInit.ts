// Ensure crypto is ready before we even create the MatrixClient.
export async function initCryptoEarly(): Promise<void> {
  // Try Rust crypto first (WASM)
  try {
    const mod = await import('@matrix-org/matrix-sdk-crypto-wasm')
    if (mod?.initAsync) await mod.initAsync()
    console.info('[Vanish] Rust crypto (WASM) loaded.')
    return
  } catch (err) {
    console.warn('[Vanish] Rust crypto unavailable, falling back to legacy OLM.', err)
  }

  // Fallback: legacy OLM asm.js
  try {
    await import('@matrix-org/olm/olm_legacy.js')
    const Olm = (window as any).Olm
    if (Olm?.init) await Olm.init()
    ;(window as any).Olm = Olm
    console.info('[Vanish] Legacy OLM (asm.js) crypto initialized.')
  } catch (e) {
    console.error('[Vanish] Crypto init failed completely!', e)
    throw e
  }
}
