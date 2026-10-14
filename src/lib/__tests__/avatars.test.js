import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MAX_AVATAR_BYTES,
  validateAvatarFile,
  buildAvatarPath,
  avatarInitials,
  uploadAvatar,
  removeAvatar,
} from '../avatars.js'

const UID = '11111111-1111-1111-1111-111111111111'

test('validateAvatarFile enforces type and 10 MB limit', () => {
  assert.equal(validateAvatarFile(null), 'No file selected')
  assert.match(validateAvatarFile({ type: 'image/gif', size: 10 }), /JPG, PNG or WebP/)
  assert.match(validateAvatarFile({ type: 'image/png', size: MAX_AVATAR_BYTES + 1 }), /10 MB/)
  assert.equal(validateAvatarFile({ type: 'image/webp', size: MAX_AVATAR_BYTES }), null)
  assert.equal(validateAvatarFile({ type: 'image/jpeg', size: 1 }), null)
})

test('buildAvatarPath is prefixed with the user id', () => {
  assert.equal(buildAvatarPath({ userId: UID, mimeType: 'image/png', version: 5 }), `${UID}/avatar-5.png`)
  assert.equal(buildAvatarPath({ userId: UID, mimeType: 'image/webp', version: 5 }), `${UID}/avatar-5.webp`)
})

test('avatarInitials', () => {
  assert.equal(avatarInitials('Ann Lee'), 'AL')
  assert.equal(avatarInitials('ann'), 'A')
  assert.equal(avatarInitials(''), 'R')
  assert.equal(avatarInitials(null), 'R')
})

function mockClient({ uploadError = null, updateError = null, existing = [] } = {}) {
  const calls = { uploads: [], removed: [], updates: [] }
  const bucket = {
    upload: async (path) => {
      calls.uploads.push(path)
      return { error: uploadError }
    },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/avatars/${path}` } }),
    list: async () => ({ data: existing.map((name) => ({ name })) }),
    remove: async (paths) => {
      calls.removed.push(...paths)
      return { error: null }
    },
  }
  return {
    calls,
    storage: { from: (name) => (name === 'avatars' ? bucket : assert.fail('wrong bucket')) },
    from: () => ({
      update: (row) => {
        calls.updates.push(row)
        return { eq: async () => ({ error: updateError }) }
      },
    }),
  }
}

test('uploadAvatar stores the URL and removes older images', async () => {
  const client = mockClient({ existing: ['old.png'] })
  const { url, error } = await uploadAvatar(client, { userId: UID, file: { type: 'image/png', size: 100 } })
  assert.equal(error, null)
  assert.match(url, new RegExp(`/avatars/${UID}/avatar-\\d+\\.png$`))
  assert.deepEqual(client.calls.updates, [{ avatar_url: url }])
  assert.deepEqual(client.calls.removed, [`${UID}/old.png`])
})

test('uploadAvatar rejects invalid files without touching storage', async () => {
  const client = mockClient()
  const { error } = await uploadAvatar(client, { userId: UID, file: { type: 'image/gif', size: 1 } })
  assert.ok(error)
  assert.equal(client.calls.uploads.length, 0)
})

test('uploadAvatar rolls back the object when the profile update fails', async () => {
  const client = mockClient({ updateError: new Error('nope') })
  const { error } = await uploadAvatar(client, { userId: UID, file: { type: 'image/jpeg', size: 1 } })
  assert.equal(error.message, 'nope')
  assert.equal(client.calls.removed.length, 1)
})

test('removeAvatar clears the URL and deletes stored files', async () => {
  const client = mockClient({ existing: ['a.png', 'b.jpg'] })
  const { error } = await removeAvatar(client, { userId: UID })
  assert.equal(error, null)
  assert.deepEqual(client.calls.updates, [{ avatar_url: null }])
  assert.deepEqual(client.calls.removed, [`${UID}/a.png`, `${UID}/b.jpg`])
})

test('migration configures the public avatars bucket with own-folder policies', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261022000000_profile_images.sql', import.meta.url), 'utf8')
  assert.match(sql, /'avatars', 'avatars', TRUE, 2097152/)
  assert.match(sql, /image\/jpeg.*image\/png.*image\/webp/)
  for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
    assert.match(sql, new RegExp(`FOR ${op} TO authenticated`))
  }
  assert.match(sql, /auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/)
  assert.match(sql, /p\.avatar_url\s*\n\s*FROM public\.profiles p/)
})

test('follow-up migration raises avatars bucket limit to 10 MB', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261023000000_avatar_size_limit.sql', import.meta.url), 'utf8')
  assert.match(sql, /file_size_limit = 10485760/)
  assert.match(sql, /image\/jpeg.*image\/png.*image\/webp/)
})
