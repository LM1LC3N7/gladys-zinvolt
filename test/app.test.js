// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Zinvolt account.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ZinvoltApp } from '../src/app.js';
import { ACTIONS, PAUSE_MIN } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { ZinvoltClient } from '../src/zinvolt/client.js';
import { createMemoryStore } from '../src/store.js';
import { createFetch } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import {
  EMAIL,
  ID1,
  ID2,
  NOW,
  PASSWORD,
  SN1,
  SN2,
  TOKEN,
  account,
  batteriesAnswer,
  json,
  offlineState,
  onlineState,
} from './fixtures/zinvolt.js';

const SELECTOR = 'zinvolt';
const DEVICE = `ext:${SELECTOR}:battery:${SN1}`;
const F = (key, device = DEVICE) => `${device}:${key}`;
const CONFIG = { email: EMAIL, password: PASSWORD };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const POLL = 60 * SECOND;

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The device as the user created it from the discovered one. */
function created(serial = SN1, id = ID1) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  return buildDevice(gladys, { key: serial, id, serial, name: 'Zinvolt Batterij' });
}

async function setup({
  config = CONFIG,
  routes = account(),
  devices = [],
  store = createMemoryStore(),
  clock = { now: NOW },
} = {}) {
  const fake = createFetch(routes);
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const timers = createFakeTimers();
  const logger = createLogger();
  const app = new ZinvoltApp({
    gladys,
    logger,
    now: () => clock.now,
    monotonic: () => clock.now,
    timers,
    store,
    client: new ZinvoltClient({ fetchImpl: fake.fetch, now: () => clock.now }),
  });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onScanRequest(() => app.scan());
  /** `ms` later, the timer looks whether a read is due. */
  const tick = async (ms = POLL) => {
    clock.now += ms;
    await timers.runIntervals();
    await app.idle();
  };
  return { app, gladys, timers, clock, logger, fake, tick, store, routes };
}

const status = (gladys) => gladys.fake.connectionStatus;
const reads = (fake) => fake.calls.filter((c) => c.path === 'system/batteries').length;
const logins = (fake) => fake.calls.filter((c) => c.path === 'login').length;
const last = (gladys, key, device) => gladys.fake.lastState(F(key, device));
const text = (message) => `${message.en} ${message.fr}`;

test('nothing configured, or bad values: the status says so, nothing is called', async () => {
  for (const [config, words] of [
    [{}, /e-mail et le mot de passe/],
    [{ email: EMAIL }, /mot de passe de votre compte/],
    [{ email: 'nope', password: PASSWORD }, /e-mail n’est pas valide/],
  ]) {
    const { app, gladys, fake } = await setup({ config });
    await app.start(config);
    await app.idle();
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, words);
    assert.equal(fake.calls.length, 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), words);
  }
});

test('the first read: the batteries in Discovery, no value before they are created', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'Zinvolt Batterij');
  assert.ok(device.features.every((f) => f.read_only));
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Découverte/);
});

test('a created battery gets its values; read-only; never the energy consumption', async () => {
  const { app, gladys, fake } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, 'soc'), 100);
  assert.equal(last(gladys, 'charge_power'), 19);
  assert.equal(last(gladys, 'discharge_power'), 0);
  assert.equal(last(gladys, 'battery_power'), -19);
  assert.equal(last(gladys, 'output_power'), -19);
  assert.equal(last(gladys, 'online'), 1);
  assert.equal(last(gladys, 'smart_mode'), 3);
  assert.equal(last(gladys, 'lower_limit'), 10);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  assert.ok(fake.calls.every((c) => c.method === 'GET' || c.path === 'login'));
  assert.match(status(gladys).message.en, /Zinvolt account read: 1 battery/);
});

test('pace: nothing reads faster than the interval (timer, reconnection, save, test, Discovery)', async () => {
  const { app, gladys, fake, tick, clock } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(reads(fake), 1);
  await tick(10 * SECOND);
  assert.equal(reads(fake), 1, 'the timer waits the interval');
  await app.start(CONFIG);
  await app.idle();
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  await gladys.fake.scanRequest();
  await app.idle();
  const answer = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(text(answer), /next read possible at 10:01:00 UTC/);
  assert.equal(reads(fake), 1);
  assert.equal(logins(fake), 1, 'the token is reused, no login per start');
  await tick(50 * SECOND);
  assert.equal(reads(fake), 2, 'read once the interval passed');
  await tick(58 * SECOND);
  assert.equal(reads(fake), 2);
  clock.now += 2 * SECOND;
  const clicked = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(clicked.fr, /Compte Zinvolt accepté/);
  assert.equal(reads(fake), 3);
});

test('a reconnection during a read starts no other read; the late read publishes nothing', async () => {
  let release;
  const routes = account({ hold: new Promise((r) => (release = r)) });
  const { app, gladys, fake, clock } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.lifecycle;
  const statuses = gladys.fake.connectionStatuses.length;
  await app.start(CONFIG);
  await app.lifecycle;
  clock.now += 2 * POLL;
  assert.ok(app.tick());
  assert.equal(reads(fake), 1, 'no second read while the first runs');
  routes.state.hold = undefined;
  release();
  await app.idle();
  assert.equal(gladys.fake.states.length, 0, 'the late read publishes nothing');
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1, 'only the restart status');
  clock.now += 1;
  await app.tick();
  await app.idle();
  assert.equal(last(gladys, 'soc'), 100);
});

test('a restart of the container never reads sooner: last request in /data, no secret there', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const first = await setup({ store, clock, devices: [created()] });
  await first.app.start(CONFIG);
  await first.app.idle();
  const saved = JSON.stringify(store.data);
  assert.doesNotMatch(saved, new RegExp(`${PASSWORD}|${EMAIL}|${TOKEN}`));
  assert.equal(store.data.lastAttemptAt, NOW);
  clock.now += 10 * SECOND;
  const second = await setup({ store, clock, devices: [created()] });
  await second.app.start(CONFIG);
  await second.app.idle();
  assert.equal(second.fake.calls.length, 0);
  assert.equal(status(second.gladys).connected, true, 'a known account is shown connected');
  assert.equal(second.gladys.fake.discoveredDevices.length, 1, 'Discovery from /data');
  await second.tick(POLL);
  assert.equal(second.fake.calls.length, 0, 'the interval and the minute of the write');
  await second.tick(MINUTE);
  assert.equal(reads(second.fake), 1);
});

test('refused credentials: final, kept in /data, no automatic try; test button and new password', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const config = { email: EMAIL, password: 'wrong password' };
  const { app, gladys, fake, tick } = await setup({ config, store, clock });
  await app.start(config);
  await app.idle();
  assert.equal(logins(fake), 1);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /refuses the e-mail or the password \(HTTP 401\)/);
  assert.equal(store.data.refusal.count, 1);
  assert.match(store.data.refusal.fp, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify(store.data), /wrong password/);
  await tick(24 * 60 * MINUTE);
  assert.equal(logins(fake), 1, 'never tried again by itself');
  // A restart with the same refused password: still stopped.
  const again = await setup({ config, store, clock });
  await again.app.start(config);
  await again.app.idle();
  await again.tick(10 * 60 * MINUTE);
  assert.equal(again.fake.calls.length, 0);
  // The test button tries once per click.
  await again.gladys.fake.action(ACTIONS.TEST);
  assert.equal(logins(again.fake), 1);
  assert.equal(store.data.refusal.count, 2);
  // The right password, saved: tried at once, the refusal erased.
  await again.app.start(CONFIG, { fresh: true });
  await again.app.idle();
  assert.equal(reads(again.fake), 1);
  assert.equal(store.data.refusal, null);
  assert.equal(status(again.gladys).connected, true);
});

test('429 and 5xx of the list: a pause kept in /data; a battery failing only left out', async () => {
  const store = createMemoryStore();
  const routes = account({ batteries: () => json({}, 429, { 'retry-after': '600' }) });
  const { app, gladys, fake, tick } = await setup({ routes, store });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(store.data.pause.code, 'rate_limited');
  assert.equal(store.data.pause.until, NOW + 10 * MINUTE);
  assert.match(status(gladys).message.en, /asks to wait/);
  await tick(9 * MINUTE);
  assert.equal(reads(fake), 1);
  routes.state.batteries = batteriesAnswer([
    [ID1, SN1, 'One'],
    [ID2, SN2, 'Two'],
  ]);
  routes.state.states[ID1] = () => json({}, 502);
  routes.state.states[ID2] = () => json(offlineState());
  await tick(MINUTE + 5 * SECOND);
  assert.equal(reads(fake), 2);
  assert.equal(store.data.pause, null);
  assert.match(status(gladys).message.en, new RegExp(`Not read this time: ${SN1}`));
  assert.match(status(gladys).message.en, new RegExp(`Offline for Zinvolt: ${SN2}`));
  assert.ok(PAUSE_MIN <= 10 * MINUTE);
});

test('an offline battery sends no live value, only its state and settings', async () => {
  const routes = account({ batteries: batteriesAnswer([[ID2, SN2, 'Two']]) });
  routes.state.states[ID2] = () => json(offlineState());
  const device = `ext:${SELECTOR}:battery:${SN2}`;
  const { app, gladys } = await setup({ routes, devices: [created(SN2, ID2)] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, 'online', device), 0);
  assert.equal(last(gladys, 'soc', device), undefined);
  assert.equal(last(gladys, 'charge_power', device), undefined);
  assert.equal(last(gladys, 'max_charge_power', device), 2000);
});

test('identity: a state naming another serial number publishes nothing for that battery', async () => {
  const routes = account();
  routes.state.states[ID1] = () => json(onlineState('ZVGOTHER0001'));
  const { app, gladys } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.states.length, 0);
  assert.match(status(gladys).message.en, /another serial number, left out: ZVG011025120088/);
});

test('an expired token: one new login in the read, then the values', async () => {
  const routes = account();
  const { app, gladys, fake, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  routes.state.token = 'eyJhIjoiYiJ9.eyJuZXciOjF9.c2ln';
  routes.state.issued = routes.state.token;
  await tick(POLL);
  assert.equal(logins(fake), 2);
  assert.equal(status(gladys).connected, true);
});

test('nothing secret in the logs nor the statuses', async () => {
  const routes = account({ login: () => json({ message: `bad ${PASSWORD}` }, 500) });
  const { app, gladys, logger } = await setup({ routes });
  await app.start(CONFIG);
  await app.idle();
  const all = [
    ...logger.lines,
    ...gladys.fake.connectionStatuses.map((s) => text(s.message ?? {})),
  ];
  for (const line of all) {
    assert.doesNotMatch(line, new RegExp(`${PASSWORD}|${EMAIL}|${TOKEN}`));
  }
});
