// lib/webauthn.ts
// NOTE: pinned to @simplewebauthn/server@^9.0.3 — next-auth@5.0.0-beta.32 declares
// @simplewebauthn/server@^9.0.2 as a peer (its experimental WebAuthn provider), so v9 is the
// newest major installable without an unresolvable peer conflict. The v9 API differs from the
// plan's draft (registrationInfo.credentialID/credentialPublicKey instead of .credential,
// `authenticator` opt instead of `credential`, explicit credential descriptor `type`), which is
// reflected below.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/types'
import { prisma } from '@/lib/db'

const rpName = 'BeybladeX.de'
const rpID = process.env.WEBAUTHN_RP_ID ?? 'localhost'
const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

export async function getRegistrationOptions(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const existing = await prisma.passkey.findMany({ where: { userId } })
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.username,
    userID: user.id,
    excludeCredentials: existing.map((p) => ({ id: Buffer.from(p.credentialId, 'base64url'), type: 'public-key' as const })),
  })
}

export async function verifyRegistration(userId: string, response: RegistrationResponseJSON, expectedChallenge: string) {
  const verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID })
  if (verification.verified && verification.registrationInfo) {
    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo
    await prisma.passkey.create({
      data: {
        userId,
        credentialId: Buffer.from(credentialID).toString('base64url'),
        publicKey: Buffer.from(credentialPublicKey).toString('base64url'),
        counter,
      },
    })
  }
  return verification.verified
}

export async function getAuthenticationOptions(username: string) {
  const user = await prisma.user.findUnique({ where: { username }, include: { passkeys: true } })
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: user?.passkeys.map((p) => ({ id: Buffer.from(p.credentialId, 'base64url'), type: 'public-key' as const })) ?? [],
  })
}

export async function verifyAuthentication(response: AuthenticationResponseJSON, expectedChallenge: string) {
  const credentialId = response.id
  const passkey = await prisma.passkey.findUnique({ where: { credentialId } })
  if (!passkey) return { verified: false }
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: Buffer.from(passkey.credentialId, 'base64url'),
      credentialPublicKey: Buffer.from(passkey.publicKey, 'base64url'),
      counter: passkey.counter,
    },
  })
  if (verification.verified) {
    await prisma.passkey.update({ where: { id: passkey.id }, data: { counter: verification.authenticationInfo.newCounter } })
  }
  return verification
}
