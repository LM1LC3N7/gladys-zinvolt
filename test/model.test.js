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
  });
  const odd = parseBatteries({
    batteries: [
      { id: 'abc-1', serial_number: 'zvg 01', name: '<b>x</b>' },
      { id: '../etc', serial_number: 'ZV1234' },
      { id: 'abc-1', serial_number: 'zvg 01' },
    ],
  });
  assert.deepEqual(odd.list, [{ key: 'id-abc-1', id: 'abc-1', serial: '', name: undefined }]);
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

test('an online state: charge, powers (charge from a negative battery power), settings', () => {
  const { sn, values } = parseCurrentState(onlineState());
  assert.equal(sn, SN1);
  assert.deepEqual(values, {
    online: 1,
    soc: 100,
    batteryPower: -19,
    chargePower: 19,
    dischargePower: 0,
    pvPower: 0,
    outputPower: -19,
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
  const discharging = parseCurrentState(onlineState(SN1, { pbt: 250, ppv: -3 })).values;
  assert.equal(discharging.dischargePower, 250);
  assert.equal(discharging.chargePower, 0);
  assert.equal(discharging.pvPower, 0, 'a few watts below 0 at night read 0');
});

test('an offline state gives no live value; odd values are left out, never 0', () => {
  const { values } = parseCurrentState(offlineState());
  assert.equal(values.online, 0);
  assert.equal(values.soc, undefined);
  assert.equal(values.chargePower, undefined);
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
