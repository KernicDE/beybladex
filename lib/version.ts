// lib/version.ts (issue #77)
// Deploy version — CalVer + build identifier: "YYYY.MM.DD+shortsha" (UTC merge date
// of the deployed commit + its short SHA). Source of truth is the APP_VERSION env var,
// baked into the Docker image at build time (.github/workflows/deploy.yml computes it
// and passes it as a build arg; Dockerfile bakes it as ENV). Every other environment
// (local dev, tests) has no APP_VERSION → documented dev fallback, never a fake prod version.
export const APP_VERSION = process.env.APP_VERSION ?? '0.0.0-dev+local'

const [versionDate, versionCommit] = APP_VERSION.split('+')

export const VERSION_DATE = versionDate ?? 'unknown'
export const VERSION_COMMIT = versionCommit ?? 'unknown'
