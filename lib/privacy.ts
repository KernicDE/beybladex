// lib/privacy.ts
// The single privacy gate every profile/collection/deck surface must call before rendering
// another user's data. Post-fetch projection: the full row is read from the DB, then nulled
// per-field here — call sites must never leak the raw subject object to a client response or
// template, only ever pass through this function's return value.
type PrivacyLevel = 'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE'

type SubjectUser = {
  id: string; username: string; displayName: string | null; city: string | null; discordTag: string | null
  bio: string | null; birthDate: Date | null; isMinor: boolean
  profileVisibility: PrivacyLevel; locationVisibility: PrivacyLevel; collectionVisibility: PrivacyLevel
  decksVisibility: PrivacyLevel; ageVisibility: PrivacyLevel
  // Phase 21: the user's uploaded avatar flows through THIS projection like every other
  // profile field — gated by profileVisibility below, never a hardcoded-always-public
  // exception. Call sites selecting a SubjectUser must include it.
  avatarImageId: string | null
}

function isVisible(level: PrivacyLevel, isOwner: boolean, isFriend: boolean): boolean {
  if (isOwner) return true
  if (level === 'PUBLIC') return true
  if (level === 'FRIENDS_ONLY') return isFriend
  return false
}

export function resolveVisibleFields(subject: SubjectUser, viewerId: string | null, isFriend: boolean) {
  const isOwner = viewerId === subject.id
  const profileVisible = isVisible(subject.profileVisibility, isOwner, isFriend)
  const locationVisible = isVisible(subject.locationVisibility, isOwner, isFriend)
  const ageVisible = isVisible(subject.ageVisibility, isOwner, isFriend)

  // [REVIEW-FIX: privacy-dsgvo #1, #7] Minor ceilings: hard server-side limits that override the
  // subject's OWN settings whenever they are a minor and the viewer is not the owner — a child
  // cannot opt themselves into wider exposure than these ceilings permit, regardless of what they
  // clicked in a settings form. This is deliberately NOT a UI-layer suggestion; it lives in the
  // one function every later phase is required to call before rendering another user's data.
  const minorCeiling = subject.isMinor && !isOwner
  const cityAllowed = locationVisible && !minorCeiling
  const discordAllowed = profileVisible && !minorCeiling
  const bioAllowed = profileVisible && !minorCeiling

  return {
    username: subject.username,
    displayName: profileVisible ? subject.displayName : null, // display name (not real name) stays visible even for minors — it's the platform identity, not a real-world identifier
    discordTag: discordAllowed ? subject.discordTag : null,
    bio: bioAllowed ? subject.bio : null,
    city: cityAllowed ? subject.city : null,
    birthDate: ageVisible ? subject.birthDate : null,
    // Phase 21: an avatar is a photo of the person (biometric-adjacent) — it renders on the
    // profile page only when the profile itself is visible, same lever as bio/discordTag.
    avatarImageId: profileVisible ? subject.avatarImageId : null,
    collectionVisible: isVisible(subject.collectionVisibility, isOwner, isFriend),
    decksVisible: isVisible(subject.decksVisibility, isOwner, isFriend),
  }
}
