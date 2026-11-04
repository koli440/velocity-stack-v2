// src/lib/server/partnerAdmin.js
// Service-role operations for developer registration, admin approval and rider disconnects. Every state change
// is written to partner_audit_log.

import { newToken, hashToken } from '../partnerOAuth.js'
import { MAX_APPS_PER_OWNER, slugify } from '../partnerApps.js'

const PUBLIC_COLUMNS = 'id, name, description, homepage_url, slug, client_id, redirect_uris, scopes, status, rate_limit_per_min, rate_limit_per_day, created_at'

export const audit = (service, row) => service.from('partner_audit_log').insert(row)

/** Creates a pending app. Returns { app, clientSecret } - the secret is shown once, only its hash is stored. */
export async function registerApp(service, ownerId, reg) {
  const { count } = await service.from('developer_apps').select('id', { count: 'exact', head: true }).eq('owner_user_id', ownerId)
  if ((count || 0) >= MAX_APPS_PER_OWNER) return { error: `You can register at most ${MAX_APPS_PER_OWNER} apps`, status: 409 }
  const clientSecret = reg.confidential ? newToken('vss') : null
  const base = slugify(reg.name) || 'app'
  for (let i = 0; i < 5; i++) {
    const slug = `${base}${i ? `-${newToken('').slice(1, 5).toLowerCase().replace(/[^a-z0-9]/g, 'x')}` : ''}`.slice(0, 38)
    const { data, error } = await service.from('developer_apps').insert({
      owner_user_id: ownerId, name: reg.name, description: reg.description, homepage_url: reg.homepage_url, slug,
      client_id: newToken('vsc'), client_secret_hash: clientSecret ? hashToken(clientSecret) : null,
      redirect_uris: reg.redirect_uris, scopes: reg.scopes, status: 'pending',
    }).select(PUBLIC_COLUMNS).single()
    if (!error) {
      await audit(service, { app_id: data.id, user_id: ownerId, event: 'app_registered', metadata: { confidential: reg.confidential } })
      return { app: data, clientSecret }
    }
    if (error.code !== '23505') return { error: error.message, status: 500 }
  }
  return { error: 'Could not allocate a unique app id, try again', status: 500 }
}

export async function listOwnApps(service, ownerId) {
  const { data } = await service.from('developer_apps').select(PUBLIC_COLUMNS).eq('owner_user_id', ownerId).order('created_at', { ascending: false })
  return data || []
}

export async function deleteOwnApp(service, ownerId, appId) {
  const { data } = await service.from('developer_apps').delete().eq('id', appId).eq('owner_user_id', ownerId).select('id')
  if (data?.length) await audit(service, { app_id: null, user_id: ownerId, event: 'app_deleted', metadata: { app_id: appId } })
  return !!data?.length
}

export async function listAllApps(service) {
  const { data: apps } = await service.from('developer_apps').select(PUBLIC_COLUMNS).order('created_at', { ascending: false }).limit(200)
  const { data: log } = await service.from('partner_audit_log').select('id, app_id, event, created_at').order('created_at', { ascending: false }).limit(30)
  return { apps: apps || [], log: log || [] }
}

export async function setAppStatus(service, adminId, appId, status) {
  const { data } = await service.from('developer_apps').update({ status }).eq('id', appId).select('id, status')
  if (!data?.length) return false
  await audit(service, { app_id: appId, user_id: adminId, event: `app_${status}`, metadata: {} })
  return true
}

/** Grants of the rider with their apps, for connectedAppsView. */
export async function loadRiderGrants(service, userId) {
  const { data: grants } = await service.from('oauth_grants').select('id, app_id, scopes, revoked_at, rotated_at, last_used_at, created_at').eq('user_id', userId)
  const ids = [...new Set((grants || []).map((g) => g.app_id))]
  const { data: apps } = ids.length ? await service.from('developer_apps').select('id, name, description, homepage_url').in('id', ids) : { data: [] }
  return { grants: grants || [], apps: apps || [] }
}

/** The rider withdraws an app: all its grants stop working at once (uploaded activities are kept). */
export async function disconnectApp(service, userId, appId) {
  const { data } = await service.from('oauth_grants').update({ revoked_at: new Date().toISOString() }).eq('user_id', userId).eq('app_id', appId).is('revoked_at', null).select('id')
  await audit(service, { app_id: appId, user_id: userId, event: 'rider_disconnect', metadata: { grants: data?.length || 0 } })
  return data?.length || 0
}
