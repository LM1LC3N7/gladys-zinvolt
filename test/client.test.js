import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZinvoltClient } from '../src/zinvolt/client.js';
import { createFetch, timeoutError } from './helpers/fakeFetch.js';
import {
  EMAIL,
  ID1,
  ID2,
  PASSWORD,
  SN1,
  SN2,
  TOKEN,
  TOKEN2,
  account,
  batteriesAnswer,
  json,
  offlineState,
} from './fixtures/zinvolt.js';

const CREDENTIALS = { email: EMAIL, password: PASSWORD };
const client = (routes) => {
  const fake = createFetch(routes);
  return { fake, client: new ZinvoltClient({ fetchImpl: fake.fetch, now: () => 0 }) };
};

test('a read: login, list, states; the password only in the login, the token only as Bearer', async () => {
  const routes = account();
  const { fake, client: c } = client(routes);
  const session = {};
  const result = await c.readAll(CREDENTIALS, session);
  assert.equal(session.token, TOKEN);
  assert.deepEqual(
    fake.calls.map((x) => `${x.method} ${x.path}`),
    ['POST login', 'GET system/batteries', `GET system/${ID1}/basic/current-state`],
  );
  assert.deepEqual(fake.calls[0].body, { email: EMAIL, password: PASSWORD });
  for (const call of fake.calls) {
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.headers['User-Agent'], undefined, 'no User-Agent of our own');
  }
  for (const call of fake.calls.slice(1)) {
    assert.equal(call.method, 'GET');
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  }
  assert.equal(result.states.get(SN1).sn, SN1);
  assert.deepEqual(result.missing, []);
  // The next read reuses the token: no login.
  await c.readAll(CREDENTIALS, session);
  assert.equal(fake.calls.filter((x) => x.path === 'login').length, 1);
});

test('a token refused later: one new login in the read, never a loop', async () => {
  const routes = account();
  const { fake, client: c } = client(routes);
  const session = { token: 'eyJhIjoiYiJ9.eyJvbGQiOjF9.c2ln' };
  routes.state.token = TOKEN2;
  routes.state.issued = TOKEN2;
  await c.readAll(CREDENTIALS, session);
  assert.equal(session.token, TOKEN2);
  assert.equal(fake.calls.filter((x) => x.path === 'login').length, 1);
  // A login whose token is refused at once: `denied`, one login only.
  routes.state.issued = TOKEN;
  const fresh = {};
  await assert.rejects(c.readAll(CREDENTIALS, fresh), { code: 'denied', status: 401 });
  assert.equal(fake.calls.filter((x) => x.path === 'login').length, 2);
});

test('a battery state refusing the token the list just accepted: left out, never a login', async () => {
  const routes = account();
  const { fake, client: c } = client(routes);
  routes[`GET system/${ID1}/basic/current-state`] = () => json({}, 401);
  const session = { token: TOKEN };
  for (let i = 0; i < 5; i++) {
    const result = await c.readAll(CREDENTIALS, session);
    assert.deepEqual(result.missing, [SN1]);
  }
  assert.equal(fake.calls.filter((x) => x.path === 'login').length, 0);
  assert.equal(session.token, TOKEN, 'the token is kept: the list takes it');
});

test('the login refuses the credentials: refused (400, 401, 403, 422); 429 and 5xx are not', async () => {
  for (const status of [400, 401, 403, 422]) {
    const routes = account({ login: () => json({ message: 'no' }, status) });
    const { client: c } = client(routes);
    await assert.rejects(c.readAll(CREDENTIALS, {}), { code: 'refused', status });
  }
  const routes = account({ login: () => json({}, 429, { 'retry-after': '120' }) });
  await assert.rejects(client(routes).client.readAll(CREDENTIALS, {}), {
    code: 'rate_limited',
    retryAfter: 120_000,
  });
  routes.state.login = () => json({}, 503);
  await assert.rejects(client(routes).client.readAll(CREDENTIALS, {}), { code: 'server' });
  routes.state.login = () => json({ nothing: true });
  await assert.rejects(client(routes).client.readAll(CREDENTIALS, {}), { code: 'unknown_answer' });
});

test('a battery failing is only left out; a 429 stops; a timeout skips the rest', async () => {
  const routes = account({
    batteries: batteriesAnswer([
      [ID1, SN1, 'One'],
      [ID2, SN2, 'Two'],
    ]),
  });
  routes.state.states[ID1] = () => json({}, 500);
  routes.state.states[ID2] = () => json(offlineState());
  const { client: c } = client(routes);
  const result = await c.readAll(CREDENTIALS, {});
  assert.deepEqual(result.missing, [SN1]);
  assert.ok(result.states.has(SN2));
  routes.state.states[ID1] = () => {
    throw timeoutError();
  };
  const cut = await c.readAll(CREDENTIALS, {});
  assert.deepEqual(cut.missing, [SN1, SN2]);
  routes.state.states[ID1] = () => json({}, 429);
  await assert.rejects(c.readAll(CREDENTIALS, {}), { code: 'rate_limited' });
});

test('hostile answers: bounded, not JSON, a redirect never followed', async () => {
  const routes = account({ batteries: () => json(' '.repeat(70 * 1024)) });
  await assert.rejects(client(routes).client.readAll(CREDENTIALS, {}), { code: 'too_large' });
  routes.state.batteries = () => json('<html>');
  await assert.rejects(client(routes).client.readAll(CREDENTIALS, {}), { code: 'not_json' });
  routes.state.batteries = () =>
    new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
  await assert.rejects(client(routes).client.readAll(CREDENTIALS, {}), {
    code: 'http',
    status: 302,
  });
  routes.state.batteries = () => json({ other: [] });
  await assert.rejects(client(routes).client.readAll(CREDENTIALS, {}), { code: 'unknown_answer' });
});

test('read-only: the client has no method that writes, the only POST is the login', () => {
  const source = readFileSync(new URL('../src/zinvolt/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'(PUT|PATCH|DELETE)'/);
  assert.equal((source.match(/method: 'POST'/g) ?? []).length, 1);
  assert.doesNotMatch(source, /switch-smart-mode|global-settings|operation\//);
  const proto = Object.getOwnPropertyNames(ZinvoltClient.prototype).sort();
  assert.deepEqual(proto, ['authed', 'constructor', 'login', 'loginOnce', 'readAll', 'request']);
});
