import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Guards against removing an export that another module still imports (regression: allTimeStyle).
const root = path.resolve(import.meta.dirname, '../../..', 'src')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []))

test('every named import from a src/lib module is exported by it', async () => {
  const re = /import\s*\{([^}]*)\}\s*from\s*'(\.[^']*\/lib\/[^']+|\.\/[^']+|\.\.\/[^']+)'/g
  const problems = []
  for (const file of walk(root).filter((f) => !f.includes('__tests__'))) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(re)) {
      let target = path.resolve(path.dirname(file), m[2])
      if (!target.startsWith(path.join(root, 'lib'))) continue
      if (!target.endsWith('.js')) target += '.js'
      if (!fs.existsSync(target)) continue
      let mod
      try { mod = await import(target) } catch { continue }
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0]
        if (name && !(name in mod)) problems.push(`${path.relative(root, file)} imports ${name} from ${path.relative(root, target)}`)
      }
    }
  }
  assert.deepEqual(problems, [])
})
