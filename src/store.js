// -----------------------------------------------------------------------------
// What must survive a restart of the container (a small JSON file under
// /data, the only writable place): the instant of the last request (written
// at most once a minute), a pause asked by the service (429/5xx), refused
// credentials, and the batteries the Discovery list shows (identifier, serial
// number, name: nothing secret).
//
// Never the e-mail, the password nor the token. The account is only known by
// a salted scrypt fingerprint of its e-mail (to see after a restart whether
// the configured account is the one of the file). While the credentials are
// refused, the file keeps a salted fingerprint of those refused credentials,
// to know after a restart whether the refusal still concerns the configured
// ones; it is erased by the first successful read. Nothing in the file can
// confirm a password that works. (After gladys-air-q and gladys-sonnen.)
//
// Written through a temporary file and a rename, one write at a time; a
// failure is logged once, never fatal. Never any text of the service but a
// battery name and serial checked by pattern.
// -----------------------------------------------------------------------------

import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { MAX_BATTERIES } from './constants.js';
import { batteryKey, nameOf, serialOf } from './zinvolt/model.js';

export const DEFAULT_STATE_FILE = '/data/zinvolt-state.json';
const MAX_FILE = 64 * 1024;

/** A JSON file: `load()` (sync, `{}` when absent or odd) and `save(data)` (atomic). */
export function createFileStore(file = DEFAULT_STATE_FILE) {
  let queue = Promise.resolve();
  const write = async (data) => {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  return {
    load() {
      try {
        const text = readFileSync(file, 'utf8');
        if (text.length > MAX_FILE) return {};
        const data = JSON.parse(text);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests). */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  let saves = 0;
  return {
    load: () => structuredClone(data),
    async save(next) {
      saves += 1;
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
    get saves() {
      return saves;
    },
  };
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX32 = /^[0-9a-f]{32}$/;

/** A pause read back: `{ until, count, code, status }`, its end capped from now. */
export function validPause(pause, now, max) {
  if (
    !isObject(pause) ||
    finite(pause.until) === undefined ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  return {
    until: Math.min(pause.until, now + max),
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** A refusal read back: `{ count, status, fp }` (final: no end, only a new gesture lifts it). */
export function validRefusal(refusal) {
  if (
    !isObject(refusal) ||
    !Number.isInteger(refusal.count) ||
    refusal.count < 1 ||
    typeof refusal.fp !== 'string' ||
    !HEX32.test(refusal.fp)
  ) {
    return undefined;
  }
  return {
    count: Math.min(refusal.count, 32),
    status: Number.isInteger(refusal.status) ? refusal.status : 401,
    fp: refusal.fp,
  };
}

/** The batteries read back (Discovery after a restart), checked like an answer. */
export function validBatteries(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of list.slice(0, MAX_BATTERIES)) {
    if (!isObject(entry) || typeof entry.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(entry.id))
      continue;
    const serial = serialOf(entry.serial);
    const key = batteryKey({ serial, id: entry.id });
    if (key !== entry.key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, id: entry.id, serial, name: nameOf(entry.name) });
  }
  return out;
}

/**
 * The persisted state, sanitized: times capped (a request never "in the
 * future", a pause never longer than a fresh one), so a clock that jumped or
 * a hand-edited file never stops the reads for longer.
 */
export function readState(raw, now, { maxPause }) {
  const data = isObject(raw) ? raw : {};
  const salt =
    typeof data.salt === 'string' && HEX32.test(data.salt)
      ? data.salt
      : randomBytes(16).toString('hex');
  const account =
    typeof data.account === 'string' && HEX32.test(data.account) ? data.account : null;
  return {
    salt,
    account,
    lastAttemptAt: Math.min(finite(data.lastAttemptAt) ?? 0, now),
    pause: account ? (validPause(data.pause, now, maxPause) ?? null) : null,
    // Kept until a read succeeds or the credentials change.
    refusal: account ? (validRefusal(data.refusal) ?? null) : null,
    batteries: account ? validBatteries(data.batteries) : [],
  };
}

/** The salted fingerprint of a text (never the text). */
export function fingerprint(salt, ...parts) {
  return scryptSync(parts.map(String).join('\n'), salt, 16).toString('hex');
}

/** The account of an e-mail (no case), as kept in /data. */
export const accountOf = (salt, email) => fingerprint(salt, 'account', email.toLowerCase());

/** The fingerprint of REFUSED credentials (never the password). */
export const credentialsOf = (salt, email, password) =>
  fingerprint(salt, 'credentials', email.toLowerCase(), password);
