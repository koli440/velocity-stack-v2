import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), 'src')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(e.name) && !p.includes('__tests__')) out.push(p)
  }
  return out
}

test('favorite route exports PUT, POST (alias) and DELETE', () => {
  const src = read('app/api/templates/[slug]/favorite/route.js')
  assert.match(src, /export async function PUT\b/)
  assert.match(src, /export const POST\s*=\s*PUT/)
  assert.match(src, /export async function DELETE\b/)
})

test('favorite callers only use methods the route supports', () => {
  const allowed = new Set(['PUT', 'POST', 'DELETE'])
  let callers = 0
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\/favorite`[^\n]*/g)) {
      callers++
      const methods = [...m[0].matchAll(/'(GET|PUT|POST|PATCH|DELETE)'/g)].map((x) => x[1])
      for (const method of methods) assert.ok(allowed.has(method), `${file}: ${method}`)
    }
  }
  assert.ok(callers >= 2)
})

test('add-favorite callers use PUT, not POST', () => {
  for (const f of ['components/TemplateRunsSection.js', 'components/PlannedTemplatePicker.js']) {
    assert.match(read(f), /\? 'DELETE' : 'PUT'/, f)
  }
})
