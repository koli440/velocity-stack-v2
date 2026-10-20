import test from 'node:test'
import assert from 'node:assert/strict'
import { rendersBeforeAthleteLoaded } from '../coachContext.js'
import { jwtSubject, bearerToken } from '../jwtSubject.js'

test('athlete pages that need only the rider id render before the profile is loaded', () => {
  for (const p of ['/templates', '/templates/', '/activities', '/calendar', '/pb-vault']) {
    assert.equal(rendersBeforeAthleteLoaded(p), true, p)
  }
  for (const p of ['', '/', '/physiology', '/templatesx', null, undefined]) {
    assert.equal(rendersBeforeAthleteLoaded(p), false, String(p))
  }
})

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

test('jwtSubject reads the sub claim and tolerates garbage', () => {
  assert.equal(jwtSubject(`${b64({ alg: 'HS256' })}.${b64({ sub: 'abc-123' })}.sig`), 'abc-123')
  assert.equal(jwtSubject('nope'), null)
  assert.equal(jwtSubject(''), null)
  assert.equal(jwtSubject(`x.${b64({ role: 'anon' })}.y`), null)
  assert.equal(jwtSubject(`x.${b64({ sub: 42 })}.y`), null)
})

test('bearerToken strips the scheme', () => {
  assert.equal(bearerToken(new Request('http://x', { headers: { authorization: 'Bearer  tok ' } })), 'tok')
  assert.equal(bearerToken(new Request('http://x')), '')
})
