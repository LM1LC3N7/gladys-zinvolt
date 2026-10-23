import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batteryKey, parseBatteries, parseCurrentState, tokenOf } from '../src/zinvolt/model.js';
import { ID1, SN1, TOKEN, batteriesAnswer, offlineState, onlineState } from './fixtures/zinvolt.js';

test('the login answer: a JWT-like token only', () => {
  assert.equal(tokenOf({ token: TOKEN }), TOKEN);
  for (const bad of [{}, { token: 1 }, { token: 'abc' }, { token: 'a.b.c\nd' }, null, []]) {
    assert.equal(tokenOf(bad), undefined);
  }
  assert.equal(tokenOf(JSON.parse('{"__proto__": {"token": "x.y.z"}}')), undefined);
});

test('the batteries: key from the serial number, a readable fallback, at most 10', () => {
  assert.deepEqual(parseBatteries(batteriesAnswer()), {
    list: [{ key: SN1, id: ID1, serial: SN1, name: 'Zinvolt Batterij' }],
    more: 0,
    skipped: 0,
  });
  const odd = parseBatteries({
    batteries: [
      { id: 'abc-1', serial_number: 'zvg 01', name: '<b>x</b>' },
      { id: '../etc', serial_number: 'ZV1234' },
      { id: 'abc-1', serial_number: 'zvg 01' },
    ],
  });
  assert.deepEqual(odd.list, [{ key: 'id-abc-1', id: 'abc-1', serial: '', name: undefined }]);
  assert.equal(odd.skipped, 1, 'the unreadable identifier is counted');
  assert.equal(batteryKey({ serial: 'zvg0110', id: 'x' }), 'ZVG0110');
  const many = parseBatteries({
    batteries: Array.from({ length: 12 }, (_, i) => ({
      id: `id${i}`,
      serial_number: `ZVG000${i + 10}`,
    })),
  });
  assert.equal(many.list.length, 10);
  assert.equal(many.more, 2);
  assert.equal(parseBatteries({}), undefined);
  assert.equal(parseBatteries({ batteries: 'x' }), undefined);
});

test('an online state: the battery power is 0 - pso (Home Assistant), no typed charge', () => {
  const { sn, values } = parseCurrentState(onlineState());
  assert.equal(sn, SN1);
  assert.deepEqual(values, {
    online: 1,
    soc: 100,
    batteryPower: 19,
    outputPower: 19,
    pvPower: 0,
    powerLimit: 800,
    onGrid: 1,
    dormant: 0,
    smartMode: 3,
    maxOutput: 800,
    upperLimit: 100,
    lowerLimit: 10,
    maxChargePower: 800,
    standbyTime: 60,
  });
  // pbt is never used, whatever it says.
  const taking = parseCurrentState(onlineState(SN1, { pso: 300, pbt: -999, ppv: -3 })).values;
  assert.equal(taking.batteryPower, -300);
  assert.equal(taking.outputPower, 0, 'nothing given to the home socket');
  assert.equal(taking.pvPower, 0, 'a few watts below 0 at night read 0');
  assert.equal(parseCurrentState(onlineState(SN1, { pso: 0 })).values.batteryPower, 0);
  assert.ok(!('chargePower' in taking) && !('dischargePower' in taking));
});

test('online flags: live values only when every flag given says ONLINE', () => {
  const head = (top, inner) => {
    const state = onlineState();
    state.onlineStatus = top;
    state.currentPower.onlineStatus = inner;
    return parseCurrentState(state).values;
  };
  assert.equal(head('ONLINE', 'ONLINE').soc, 100);
  for (const [top, inner] of [
    ['ONLINE', 'OFFLINE'],
    ['OFFLINE', 'ONLINE'],
    ['ONLINE', 'SLEEPING'],
  ]) {
    const v = head(top, inner);
    assert.equal(v.online, 0, `${top}/${inner}`);
    assert.equal(v.soc, undefined);
    assert.equal(v.batteryPower, undefined);
  }
  assert.equal(head(undefined, 'ONLINE').soc, 100, 'one flag, ONLINE');
  const none = head(undefined, undefined);
  assert.equal(none.online, undefined);
  assert.equal(none.soc, undefined);
  assert.equal(none.maxOutput, 800, 'the settings still');
});

test('an offline state gives no live value; odd values are left out, never 0', () => {
  const { values } = parseCurrentState(offlineState());
  assert.equal(values.online, 0);
  assert.equal(values.soc, undefined);
  assert.equal(values.batteryPower, undefined);
  assert.equal(values.maxChargePower, 2000);
  const odd = parseCurrentState({
    onlineStatus: 'ONLINE',
    currentPower: { soc: 140, pbt: null, ppv: '12abc', onGrid: 'yes' },
    smartMode: 'TURBO',
  }).values;
  assert.deepEqual(odd, { online: 1 });
  assert.equal(parseCurrentState({}).sn, '');
  assert.equal(parseCurrentState({ currentPower: { soc: 50 } }).values.soc, undefined, 'no status');
});
