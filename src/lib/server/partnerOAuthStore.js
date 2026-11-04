// src/lib/server/partnerOAuthStore.js
// Supabase (service role) implementation of the store used by partnerOAuthFlow.js.

import { getServiceClient } from './connections.js'

export function createPartnerStore(db = getServiceClient()) {
  if (!db) return null
  const one = async (q) => (await q.maybeSingle()).data || null
  return {
    getAppByClientId: (clientId) => one(db.from('developer_apps').select('*').eq('client_id', clientId)),
    getAppById: (id) => one(db.from('developer_apps').select('*').eq('id', id)),
    async saveCode(row) {
      const { error } = await db.from('oauth_authorization_codes').insert(row)
      if (error) throw error
    },
    // Single UPDATE ... WHERE used_at IS NULL: only one caller can win a code.
    async consumeCode(hash) {
      return one(db.from('oauth_authorization_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', hash).is('used_at', null).select('*'))
    },
    async saveGrant(row) {
      const { error } = await db.from('oauth_grants').insert(row)
      if (error) throw error
    },
    getGrantByRefresh: (hash) => one(db.from('oauth_grants').select('*').eq('refresh_token_hash', hash)),
    getGrantByAccess: (hash) => one(db.from('oauth_grants').select('*').eq('access_token_hash', hash)),
    async markRotated(id) {
      const row = await one(db.from('oauth_grants').update({ rotated_at: new Date().toISOString() }).eq('id', id).is('rotated_at', null).select('id'))
      return !!row
    },
    async revokeFamily(familyId) {
      await db.from('oauth_grants').update({ revoked_at: new Date().toISOString() }).eq('family_id', familyId).is('revoked_at', null)
    },
    async touchGrant(id) {
      await db.from('oauth_grants').update({ last_used_at: new Date().toISOString() }).eq('id', id)
    },
    async audit(row) {
      const { error } = await db.from('partner_audit_log').insert(row)
      if (error) console.warn('partner audit failed:', error.message)
    },
  }
}
