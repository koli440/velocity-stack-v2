// Activity photo gallery helpers (issue #49). Photos live in the private
// `activity-photos` bucket and are read through short-lived signed URLs.

export const PHOTO_BUCKET = 'activity-photos'
export const MAX_PHOTOS_PER_ACTIVITY = 10
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024
export const MAX_PHOTO_DIMENSION = 1600
export const SIGNED_URL_TTL_S = 3600
export const ALLOWED_PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** @returns {string|null} an error message, or null when the file can be uploaded */
export function validatePhotoFile(file, existingCount = 0) {
  if (!file) return 'No file selected'
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return 'Only JPG, PNG or WebP photos are allowed'
  if (file.size > MAX_PHOTO_BYTES) return 'Photo is larger than 8 MB'
  if (existingCount >= MAX_PHOTOS_PER_ACTIVITY) {
    return `An activity can have at most ${MAX_PHOTOS_PER_ACTIVITY} photos`
  }
  return null
}

export function buildPhotoPath({ userId, activityId, mimeType, id }) {
  const ext = EXTENSIONS[mimeType] || 'jpg'
  const unique = id || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return `${userId}/${activityId}/${unique}.${ext}`
}

/** Target size that fits within maxDimension, preserving aspect ratio (never upscales). */
export function fitWithin(width, height, maxDimension = MAX_PHOTO_DIMENSION) {
  const longest = Math.max(width, height)
  if (!longest || longest <= maxDimension) return { width, height }
  const scale = maxDimension / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Signed URLs for the given storage paths as a Map(path -> url). */
export async function signPhotoUrls(client, paths, expiresIn = SIGNED_URL_TTL_S) {
  const unique = [...new Set((paths || []).filter(Boolean))]
  if (!unique.length) return { urls: new Map(), error: null }
  const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrls(unique, expiresIn)
  if (error) return { urls: new Map(), error }
  const urls = new Map()
  for (const row of data || []) {
    if (row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
  }
  return { urls, error: null }
}

export async function fetchActivityPhotos(client, activityId) {
  const { data, error } = await client
    .from('activity_photos')
    .select('id, activity_id, storage_path, position, created_at')
    .eq('activity_id', activityId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { photos: [], error }
  const rows = data || []
  const { urls } = await signPhotoUrls(client, rows.map((r) => r.storage_path))
  return {
    photos: rows.filter((r) => urls.has(r.storage_path)).map((r) => ({ ...r, url: urls.get(r.storage_path) })),
    error: null,
  }
}

/** Reduces photo rows to Map(activityId -> { path, count }) using the first photo as cover. */
export function pickCovers(rows) {
  const covers = new Map()
  const sorted = [...(rows || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.created_at).localeCompare(String(b.created_at))
  )
  for (const row of sorted) {
    const existing = covers.get(row.activity_id)
    if (existing) existing.count++
    else covers.set(row.activity_id, { path: row.storage_path, count: 1 })
  }
  return covers
}

/** One query + one signing call for a whole feed page: Map(activityId -> { url, count }). */
export async function fetchCoverPhotos(client, activityIds) {
  const ids = [...new Set((activityIds || []).filter(Boolean))]
  if (!ids.length) return { covers: new Map(), error: null }
  const { data, error } = await client
    .from('activity_photos')
    .select('activity_id, storage_path, position, created_at')
    .in('activity_id', ids)
  if (error) return { covers: new Map(), error }

  const picked = pickCovers(data)
  const { urls } = await signPhotoUrls(client, [...picked.values()].map((c) => c.path))
  const covers = new Map()
  for (const [activityId, { path, count }] of picked) {
    if (urls.has(path)) covers.set(activityId, { url: urls.get(path), count })
  }
  return { covers, error: null }
}

/** Uploads an (already resized) blob and records it. Cleans up the file if the row insert fails. */
export async function uploadActivityPhoto(client, { userId, activityId, blob, position = 0 }) {
  const mimeType = blob?.type || 'image/jpeg'
  const err = validatePhotoFile({ type: mimeType, size: blob?.size ?? 0 })
  if (err) return { photo: null, error: new Error(err) }

  const path = buildPhotoPath({ userId, activityId, mimeType })
  const { error: uploadError } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: false })
  if (uploadError) return { photo: null, error: uploadError }

  const { data, error } = await client
    .from('activity_photos')
    .insert({ activity_id: activityId, user_id: userId, storage_path: path, position })
    .select('id, activity_id, storage_path, position, created_at')
    .single()
  if (error) {
    await client.storage.from(PHOTO_BUCKET).remove([path])
    return { photo: null, error }
  }
  return { photo: data, error: null }
}

export async function deleteActivityPhoto(client, photo) {
  const { error } = await client.from('activity_photos').delete().eq('id', photo.id)
  if (error) return { error }
  const { error: storageError } = await client.storage.from(PHOTO_BUCKET).remove([photo.storage_path])
  if (storageError) console.warn('Failed to remove photo file:', storageError.message)
  return { error: null }
}

/** Removes all photo files of an activity (call before deleting the activity; rows cascade). */
export async function removeActivityPhotoFiles(client, activityId) {
  const { data } = await client.from('activity_photos').select('storage_path').eq('activity_id', activityId)
  const paths = (data || []).map((r) => r.storage_path)
  if (paths.length) await client.storage.from(PHOTO_BUCKET).remove(paths)
}
