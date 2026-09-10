// instrumentation.ts (RC3 #60)
// Boot-time validation of the security-critical environment (lib/env.ts). register() runs once
// when a Node.js server instance starts and must complete before requests are served, so a
// misconfigured deploy fails loudly here instead of at first use of, e.g., TOTP. The dynamic
// import keeps this (and lib/env) out of any edge-runtime bundle; lib/env has no import-time side
// effects, so unit tests are unaffected.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateServerEnv } = await import('@/lib/env')
    validateServerEnv()
  }
}
