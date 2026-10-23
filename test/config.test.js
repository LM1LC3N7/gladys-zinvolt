import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';

test('the configuration: problems named, the password never kept when invalid', () => {
  assert.equal(normalizeConfig({}).problem, 'email_missing');
  assert.equal(normalizeConfig({ email: 'not an email', password: 'x' }).problem, 'email_invalid');
  assert.equal(normalizeConfig({ email: 'a@b.c' }).problem, 'password_missing');
  for (const bad of ['line\nbreak', 'x'.repeat(257), `a${String.fromCharCode(0)}b`]) {
    const config = normalizeConfig({ email: 'a@b.c', password: bad });
    assert.equal(config.problem, 'password_invalid');
    assert.equal(config.password, undefined);
  }
  const ok = normalizeConfig({ email: ' a@b.c ', password: ' with spaces ', poll_interval: '120' });
  assert.deepEqual(ok, {
    email: 'a@b.c',
    password: ' with spaces ',
    pollInterval: 120,
    problem: undefined,
  });
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: 9999 }).pollInterval, 900);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 60);
});
