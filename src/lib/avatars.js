// Profile images (issue #30). Files live in the public `avatars` bucket under
// `<user_id>/`; the public URL is stored in profiles.avatar_url (see migration
// 20261022000000_profile_images.sql). Images are uploaded as-is and cropped with CSS.

export const AVATAR_BUCKET = 'avatars'
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024
export const ALLOWED_AVATAR_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** @returns {string|null} an error message, or null when the file can be uploaded */
export function validateAvatarFile(file) {
  if (!file) return 'No file selected'
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) return 'Only JPG, PNG or WebP images are allowed'
  if (file.size > MAX_AVATAR_BYTES) return 'Image is larger than 10 MB'
  return null
}

// A new object name per upload keeps CDN/browser caches from serving the old image.
export function buildAvatarPath({ userId, mimeType, version = Date.now() }) {
  return `${userId}/avatar-${version}.${EXTENSIONS[mimeType] || 'jpg'}`
}

export function avatarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'R'
  const letters = parts.length === 1 ? parts[0].slice(0, 1) : parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)
  return letters.toUpperCase()
}

/** Uploads the file, stores its URL on the profile and removes the previous objects. */
export async function uploadAvatar(client, { userId, file }) {
  const invalid = validateAvatarFile(file)
  if (invalid) return { url: null, error: new Error(invalid) }
  if (!userId) return { url: null, error: new Error('Not signed in') }

  const path = buildAvatarPath({ userId, mimeType: file.type })
  const bucket = client.storage.from(AVATAR_BUCKET)
  const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type, cacheControl: '3600' })
  if (uploadError) return { url: null, error: uploadError }

  const { data } = bucket.getPublicUrl(path)
  const url = data?.publicUrl
  const { error } = await client.from('profiles').update({ avatar_url: url }).eq('id', userId)
  if (error) {
    await bucket.remove([path])
    return { url: null, error }
  }
  await removeAvatarObjects(client, userId, path)
  return { url, error: null }
}

/** Clears profiles.avatar_url and deletes the rider's stored images. */
export async function removeAvatar(client, { userId }) {
  if (!userId) return { error: new Error('Not signed in') }
  const { error } = await client.from('profiles').update({ avatar_url: null }).eq('id', userId)
  if (error) return { error }
  await removeAvatarObjects(client, userId)
  return { error: null }
}

// Best effort: a failed cleanup only leaves an orphaned file behind.
async function removeAvatarObjects(client, userId, keepPath = null) {
  const bucket = client.storage.from(AVATAR_BUCKET)
  const { data } = await bucket.list(userId)
  const stale = (data || []).map((o) => `${userId}/${o.name}`).filter((p) => p !== keepPath)
  if (stale.length) await bucket.remove(stale)
}
