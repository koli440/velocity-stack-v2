'use client'

import { useEffect, useRef, useState } from 'react'
import Portal from './Portal'
import Icon from './ActivityIcons'
import { canNavigate, nextIndex, prevIndex, positionLabel, adjacentIndices, keyAction, swipeAction } from '../lib/lightboxNav'
import { supabase } from '../lib/supabase'
import {
  MAX_PHOTOS_PER_ACTIVITY,
  MAX_PHOTO_DIMENSION,
  validatePhotoFile,
  fitWithin,
  fetchActivityPhotos,
  uploadActivityPhoto,
  deleteActivityPhoto,
} from '../lib/activityPhotos'

// Downscales to MAX_PHOTO_DIMENSION and re-encodes (also strips EXIF/GPS metadata).
async function resizeImage(file) {
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_PHOTO_DIMENSION)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image'))), type, 0.85)
  )
}

// Photo gallery for an activity (issue #49). Anyone who can see the activity can view;
// only the owner sees upload/delete controls.
export default function ActivityPhotoGallery({ activityId, ownerId }) {
  const [photos, setPhotos] = useState([])
  const [currentUserId, setCurrentUserId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [lightboxId, setLightboxId] = useState(null)
  const touchStart = useRef(null)
  const inputRef = useRef(null)

  const load = async () => {
    const { photos: rows } = await fetchActivityPhotos(supabase, activityId)
    setPhotos(rows)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setCurrentUserId(session?.user?.id ?? null))
    if (activityId) load()
  }, [activityId])

  const lightboxIndex = lightboxId ? photos.findIndex((p) => p.id === lightboxId) : -1
  const lightbox = lightboxIndex >= 0 ? photos[lightboxIndex] : null
  const multi = canNavigate(photos.length)

  const go = (action) => {
    if (action === 'close') setLightboxId(null)
    else if (action === 'next') setLightboxId(photos[nextIndex(lightboxIndex, photos.length)].id)
    else if (action === 'prev') setLightboxId(photos[prevIndex(lightboxIndex, photos.length)].id)
  }

  useEffect(() => {
    if (!lightbox) return undefined
    const onKey = (e) => {
      const action = keyAction(e.key, photos.length)
      if (action) {
        e.preventDefault()
        go(action)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!lightbox) return
    adjacentIndices(lightboxIndex, photos.length).forEach((i) => {
      new Image().src = photos[i].url
    })
  }, [lightboxIndex, photos])

  const onTouchStart = (e) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const action = swipeAction(t.clientX - start.x, t.clientY - start.y, photos.length)
    if (action) go(action)
  }

  const isOwner = currentUserId && currentUserId === ownerId

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    setError(null)
    let count = photos.length
    try {
      for (const file of files) {
        const problem = validatePhotoFile(file, count)
        if (problem) {
          setError(problem)
          break
        }
        const blob = await resizeImage(file)
        const { error: uploadError } = await uploadActivityPhoto(supabase, {
          userId: currentUserId,
          activityId,
          blob,
          position: count,
        })
        if (uploadError) {
          setError(uploadError.message)
          break
        }
        count++
      }
    } catch (err) {
      setError(err.message)
    } finally {
      await load()
      setBusy(false)
    }
  }

  const handleDelete = async (photo) => {
    if (!window.confirm('Delete this photo?')) return
    const { error: deleteError } = await deleteActivityPhoto(supabase, photo)
    if (deleteError) setError(deleteError.message)
    setLightboxId(null)
    await load()
  }

  if (!isOwner && photos.length === 0) return null

  return (
    <div className="glass-dense bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
          Photos ({photos.length})
        </h3>
        {isOwner && photos.length < MAX_PHOTOS_PER_ACTIVITY && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="text-xs font-bold text-orange-500 hover:text-orange-600 disabled:opacity-50"
            >
              {busy ? 'Uploading…' : '+ Add photos'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={handleFiles}
            />
          </>
        )}
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setLightboxId(photo.id)}
            className="aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`Activity photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {lightbox && (
        <Portal lockScroll><div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4 bg-slate-950/90"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxId(null)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt={`Activity photo ${lightboxIndex + 1}`}
            className="max-h-[80vh] max-w-full rounded-xl select-none"
            onClick={(e) => e.stopPropagation()}
          />
          {multi && (
            <>
              {[['prev', 'chevronLeft', 'Previous photo', 'left-2'], ['next', 'chevronRight', 'Next photo', 'right-2']].map(
                ([action, icon, label, side]) => (
                  <button
                    key={action}
                    type="button"
                    aria-label={label}
                    onClick={(e) => {
                      e.stopPropagation()
                      go(action)
                    }}
                    className={`glass-popover absolute ${side} top-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center bg-slate-900 text-white border border-white/20 shadow-lg hover:bg-slate-800`}
                  >
                    <Icon name={icon} size={24} />
                  </button>
                )
              )}
              <span
                aria-live="polite"
                className="glass-popover px-3 py-1 rounded-full text-xs font-bold bg-slate-900 text-white border border-white/20"
              >
                {positionLabel(lightboxIndex, photos.length)}
              </span>
            </>
          )}
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxId(null)}
              className="min-h-[44px] px-4 rounded-xl text-xs font-bold bg-slate-800 text-white"
            >
              Close
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={() => handleDelete(lightbox)}
                className="min-h-[44px] px-4 rounded-xl text-xs font-bold bg-slate-900 text-rose-400 border border-rose-400/40"
              >
                Delete
              </button>
            )}
          </div>
        </div></Portal>
      )}
    </div>
  )
}
