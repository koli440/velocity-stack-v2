// Adversarial checks for 20270193000000_admin_mcp_stats.sql (Claude / MCP usage in the admin "Third-party apps" panel).
// Run with harness.mjs after all migrations, see README.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
async function as(c, role, user, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${role}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('COMMIT')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}

export async function run(c) {
  const U = {}
  for (const n of ['admin', 'rider', 'rider2', 'owner']) {
    U[n] = randomUUID()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2)`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`) // profile guard trigger
  await c.query(`UPDATE public.profiles SET is_admin = true WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const app = (await c.query(`INSERT INTO developer_apps(owner_user_id, name, slug, client_id, status) VALUES ($1,'Claude','claude-x','vsc_x','approved') RETURNING id`, [U.owner])).rows[0].id
  const cimd = (await c.query(`INSERT INTO developer_apps(owner_user_id, name, slug, client_id, status) VALUES (NULL,'Claude Code','cimd-abc','https://claude.ai/oauth/claude-code-client-metadata','approved') RETURNING id`)).rows[0].id

  const hit = (a, u, tool, err = false) => as(c, 'service_role', null, `SELECT mcp_usage_hit($1, $2, $3, $4)`, [a, u, tool, err])
  ok('service role records a call', (await hit(app, U.rider, 'list_planned_workouts')).ok)
  await hit(app, U.rider, 'list_planned_workouts', true)
  await hit(app, U.rider2, 'create_race')
  await hit(cimd, U.rider, 'get_fitness')
  ok('invalid tool names are ignored', (await hit(app, U.rider, 'DROP TABLE x;--')).ok && (await c.query(`SELECT count(*)::int n FROM mcp_tool_usage`)).rows[0].n === 3)
  for (const role of ['anon', 'authenticated']) {
    ok(`${role} cannot record usage`, !(await as(c, role, U.rider, `SELECT mcp_usage_hit($1, $2, 'get_fitness', false)`, [app, U.rider])).ok)
    ok(`${role} cannot read the usage tables`, !(await as(c, role, U.rider, `SELECT * FROM mcp_tool_usage`)).ok && !(await as(c, role, U.rider, `SELECT * FROM mcp_active_riders`)).ok)
  }
  await c.query(`INSERT INTO partner_audit_log(app_id, user_id, event, metadata) VALUES ($1,$2,'mcp_write','{"tool":"create_race"}'), ($1,$2,'rate_limited','{"via":"mcp"}')`, [app, U.rider2])

  ok('non-admin cannot read the stats', !(await as(c, 'authenticated', U.rider, `SELECT admin_partner_stats(30)`)).ok)
  const r = await as(c, 'authenticated', U.admin, `SELECT admin_partner_stats(30) AS s`)
  ok('admin reads the stats', r.ok)
  const s = r.rows[0].s
  ok('mcp totals', s.mcp.calls_7d === 4 && s.mcp.errors_7d === 1 && s.mcp.riders_7d === 2 && s.mcp.writes_7d === 1 && s.mcp.rate_limited_7d === 1 && s.mcp.cimd_clients === 1)
  ok('calls_by_day covers the window', s.mcp.calls_by_day.length === 30 && s.mcp.calls_by_day.at(-1).count === 4)
  const lp = s.mcp.tools.find((t) => t.tool === 'list_planned_workouts')
  ok('per-tool rows', lp.calls_30d === 2 && lp.errors_30d === 1 && s.mcp.tools[0].tool === 'list_planned_workouts')
  const a = s.apps.find((x) => x.id === app)
  const b = s.apps.find((x) => x.id === cimd)
  ok('per-app MCP columns', a.mcp_calls_7d === 3 && a.mcp_riders_7d === 2 && a.mcp_errors_7d === 1 && a.mcp_writes_7d === 1 && a.kind === 'registered')
  ok('CIMD app is marked', b.kind === 'cimd' && b.mcp_calls_7d === 1)
  ok('existing keys are kept', 'apps_by_status' in s && 'uploads_by_day' in s && 'recent_failures' in s && 'connected_riders' in s)
  ok('no rider ids in the output', !JSON.stringify(s).includes(U.rider) && !JSON.stringify(s).includes(U.rider2))
}
