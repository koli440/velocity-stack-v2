// Admin check for API routes: the bearer token identifies the user, is_admin is read with the service client.
import { getRequestUser } from '../supabaseServer'

export async function requireAdmin(req, service) {
  const { user } = await getRequestUser(req)
  if (!user) return { ok: false, status: 401 }
  const { data } = await service.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return data?.is_admin ? { ok: true, user } : { ok: false, status: 403 }
}
