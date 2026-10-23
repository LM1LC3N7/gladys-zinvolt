// -----------------------------------------------------------------------------
// The answers of the Zinvolt service -> our values. Pure.
//
// The keys and their meaning come from python-zinvolt (joostlek, MIT,
// `src/zinvolt/models.py`, `zinvolt.py` and its test answers):
// - login: `{ token }` (a JWT, used as a Bearer token);
// - system/batteries: `{ batteries: [{ id, name, serial_number }] }`;
// - system/<id>/basic/current-state: `sn`, `name`, `onlineStatus` (ONLINE,
//   OFFLINE), `smartMode` (DYNAMIC, CHARGED, PERFORMANCE, DEFAULT, FEED,
//   CUSTOM, SELF_USE), `currentPower` (`soc` state of charge %, `ppv` solar
//   power W, `pso` power of the socket W (Home Assistant shows `0 - pso`),
//   `smp` power limit W, `onGrid`, `isDormancy`; only `onlineStatus` when
//   offline; `pbt`, `bpd` and `statistic` are not in the library's model and
//   not used),
//   `globalSettings` (`maxOutput` W, `batHighCap` %, `batUseCap` %,
//   `maxChargePower` W, `standbyTime` min).
//
// Hostile answers: only own keys are read (never the prototype), only finite
// numbers are taken, every value is checked against a range; anything else is
// left out, never read as 0. Never a text of the service in a message, except
// a battery name and serial checked by pattern.
// -----------------------------------------------------------------------------

import { MAX_BATTERIES, POWER_MAX } from '../constants.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, key) => (isObject(o) && Object.hasOwn(o, key) ? o[key] : undefined);

/** A number the service sent: a finite number, or a string of a plain decimal number. */
export function num(v) {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === 'string' && /^-?\d{1,12}(\.\d{1,9})?$/.test(v.trim())) {
    return Number(v.trim());
  }
  return undefined;
}

/** `key` of `o`, a number within [min, max], else undefined. */
function read(o, key, min, max) {
  const v = num(own(o, key));
  return v !== undefined && v >= min && v <= max ? v : undefined;
}

const flag = (o, key) => {
  const v = own(o, key);
  return typeof v === 'boolean' ? (v ? 1 : 0) : undefined;
};

/** A token of the login answer: a JWT-like text, bounded. */
const TOKEN = /^[A-Za-z0-9_-]{2,2000}\.[A-Za-z0-9_-]{2,4000}\.[A-Za-z0-9_-]{0,1000}$/;

/** The token of a login answer, or undefined. */
export function tokenOf(answer) {
  const token = own(answer, 'token');
  return typeof token === 'string' && TOKEN.test(token) ? token : undefined;
}

/** A serial number: letters, digits, `-` and `_`, 4 to 40 characters. */
const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
/** The identifier of a battery in the URLs of the service (a UUID in the library's tests). */
const IDENTIFIER = /^[A-Za-z0-9-]{1,64}$/;
/** A name shown in Gladys: printable, no markup, 1 to 60 characters. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'()+-]{0,59}$/u;

export const serialOf = (v) => (typeof v === 'string' && SERIAL.test(v.trim()) ? v.trim() : '');

/**
 * The key of the external id of a battery (forever): its serial number in
 * upper case; without a readable one, `id-` and its identifier in lower case
 * (a readable fallback, documented in TODO.md "Decisions").
 */
export function batteryKey({ serial, id }) {
  if (serial) return serial.toUpperCase();
  return `id-${String(id).toLowerCase()}`;
}

/** A name to show, or undefined. */
export function nameOf(v) {
  return typeof v === 'string' && NAME.test(v.trim()) ? v.trim() : undefined;
}

/**
 * The batteries of the account: `{ list: [{ key, id, serial, name }], more,
 * skipped }` (at most MAX_BATTERIES, `more` the number left out). An entry
 * without a usable identifier is skipped (counted in `skipped`, said in the
 * status). Undefined when it is not such an answer.
 */
export function parseBatteries(answer) {
  const raw = own(answer, 'batteries');
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const list = [];
  const seen = new Set();
  let more = 0;
  let skipped = 0;
  for (const entry of raw.slice(0, 200)) {
    const id = own(entry, 'id');
    if (typeof id !== 'string' || !IDENTIFIER.test(id)) {
      skipped += 1;
      continue;
    }
    const serial = serialOf(own(entry, 'serial_number'));
    const key = batteryKey({ serial, id });
    if (seen.has(key)) continue;
    seen.add(key);
    if (list.length >= MAX_BATTERIES) {
      more += 1;
      continue;
    }
    list.push({ key, id, serial, name: nameOf(own(entry, 'name')) });
  }
  return { list, more, skipped };
}

/** The smart modes of the library, as numbers for Gladys (forever). */
export const SMART_MODES = {
  DEFAULT: 0,
  SELF_USE: 1,
  DYNAMIC: 2,
  CHARGED: 3,
  PERFORMANCE: 4,
  FEED: 5,
  CUSTOM: 6,
};

const ONLINE = { ONLINE: 1, OFFLINE: 0 };

const upper = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : undefined);

/**
 * The online state of an answer: 1 only when every status given says ONLINE
 * (the top one and the one of `currentPower`), 0 when one says OFFLINE or
 * anything else, undefined when neither is readable.
 */
function onlineOf(answer, power) {
  const given = [own(answer, 'onlineStatus'), own(power, 'onlineStatus')]
    .filter((s) => s !== undefined)
    .map((s) => ONLINE[upper(s)]);
  if (given.length === 0) return undefined;
  return given.every((s) => s === 1) ? 1 : 0;
}

/**
 * A current state -> `{ sn, values }`. `sn` is the serial number it names
 * (empty when unreadable: that never means another battery). `values`: only
 * what came, checked; powers in W. Unless every status given says ONLINE, no
 * live value is taken: the last ones are never sent again as new.
 *
 * Signs: the socket power (`pso`, the exchange of the device at its socket,
 * solar included: not the power of the battery cells) follows Home
 * Assistant (its Zinvolt sensor publishes `0 - pso`): > 0 to the home, < 0
 * from it. `pbt` (not in the library's model) is not used. To be confirmed
 * on a real battery (TODO.md).
 */
export function parseCurrentState(answer) {
  const power = own(answer, 'currentPower');
  const settings = own(answer, 'globalSettings');
  const v = {};
  const status = onlineOf(answer, power);
  v.online = status;
  if (status === 1) {
    v.soc = read(power, 'soc', 0, 100);
    const pso = read(power, 'pso', -POWER_MAX, POWER_MAX);
    if (pso !== undefined) {
      v.socketPower = pso === 0 ? 0 : -pso;
      // The power the device gives to the home through its socket (>= 0).
      v.outputPower = Math.max(0, v.socketPower);
    }
    // A solar input reads a few watts below 0 at night: 0, never the last value of the day.
    const pv = read(power, 'ppv', -200, POWER_MAX);
    v.pvPower = pv === undefined ? undefined : Math.max(0, pv);
    v.powerLimit = read(power, 'smp', 0, POWER_MAX);
    v.onGrid = flag(power, 'onGrid');
    v.dormant = flag(power, 'isDormancy');
  }
  const mode = SMART_MODES[upper(own(answer, 'smartMode'))];
  v.smartMode = mode;
  v.maxOutput = read(settings, 'maxOutput', 0, POWER_MAX);
  v.upperLimit = read(settings, 'batHighCap', 0, 100);
  v.lowerLimit = read(settings, 'batUseCap', 0, 100);
  v.maxChargePower = read(settings, 'maxChargePower', 0, POWER_MAX);
  v.standbyTime = read(settings, 'standbyTime', 0, 100_000);
  for (const name of Object.keys(v)) {
    if (v[name] === undefined) {
      delete v[name];
    }
  }
  return { sn: serialOf(own(answer, 'sn')), values: v };
}

/** Whether an answer looks like a current state of a battery (not another document). */
export function isCurrentState(answer) {
  return (
    isObject(answer) &&
    (Object.hasOwn(answer, 'currentPower') ||
      Object.hasOwn(answer, 'onlineStatus') ||
      Object.hasOwn(answer, 'globalSettings'))
  );
}
