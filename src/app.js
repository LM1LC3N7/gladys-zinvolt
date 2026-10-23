// -----------------------------------------------------------------------------
// The integration itself: the Zinvolt account of the configuration (e-mail
// and password), read every 60 s by default (login when needed, the list of
// the batteries, the current state of each one), their devices, the pauses
// and the refusal of the credentials kept in /data, the test button. index.js
// only wires the SDK handlers to it.
//
// READ-ONLY: the login and GET requests only; no smart mode, no output limit,
// no charge threshold is ever sent (no onSetValue at all).
//
// Pace: nothing reads the account faster than the interval: not the timer,
// not the test button, not Discovery, not a (re)connection to Gladys, not a
// save of an unchanged configuration, not a restart of the container (the
// instant of the last request is kept in /data, written at most once a
// minute). New credentials may be tried at once.
//
// A read belongs to its generation (each start/stop opens a new one): a read
// that ends after a restart or a new configuration publishes nothing and sets
// no status. Identity: each current state must name the serial number of the
// battery it was asked for (an unreadable one is not "another battery").
//
// Two clocks: `now` (wall clock) for what /data keeps and the texts;
// `monotonic` paces the reads, so that a wall clock set back never stops them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  ATTEMPT_SAVE_EVERY,
  FRESH_INTERVALS,
  PAUSE_MAX,
  PAUSE_MIN,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STATES_PER_MINUTE,
  TEST_ANSWER_WITHIN,
  TICK,
} from './constants.js';
import { buildDevice, ids, readStates } from './devices.js';
import { T } from './i18n.js';
import { ZinvoltClient } from './zinvolt/client.js';
import { parseCurrentState } from './zinvolt/model.js';
import { accountOf, createFileStore, credentialsOf, readState } from './store.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

const MINUTE = 60_000;

export class ZinvoltApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'zinvolt' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    client,
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.client = client ?? new ZinvoltClient({ now });
    this.store = store;
    /** What /data keeps (src/store.js readState), read once. */
    this.kept = readState(store.load(), now(), { maxPause: PAUSE_MAX });
    /** The instant of the last request as written in /data (written at most once a minute). */
    this.savedAttemptAt = this.kept.lastAttemptAt;
    /**
     * After a restart of the container: the first read waits the interval
     * and the minute the last request may have come after the one written.
     */
    this.restartedAt = this.kept.lastAttemptAt > 0 ? this.kept.lastAttemptAt : 0;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** The password of the last start (memory only): another one may be tried at once. */
    this.knownPassword = undefined;
    /** The token of the login (memory only, never in /data): `{ token }`, one object per account. */
    this.session = {};
    /** Monotonic time of the last request started, in this process. */
    this.lastAttemptMono = undefined;
    /** Unreachable / odd answer: failures in a row, the monotonic time of the next try. */
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
    /** By battery key: `{ values, at }` (monotonic) of its last good read. */
    this.values = new Map();
    /** The last good read: `{ at (wall clock), count, missing, offline, mismatch, more }`. */
    this.lastRead = undefined;
    this.publishedDevices = undefined;
    /** The states sent in the last minute: `[{ at, count }]`, monotonic (STATES_PER_MINUTE). */
    this.sent = [];
    this.timer = undefined;
    this.busy = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user saved the form (not a reconnection). */
  start(raw = {}, { fresh = false } = {}) {
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    const { email, password } = this.config;
    let changed = false;
    if (email) {
      const account = accountOf(this.kept.salt, email);
      if (account !== this.kept.account) {
        // Another account: its pace, pause, refusal and batteries start afresh
        // (the devices created stay in Gladys).
        Object.assign(this.kept, {
          account,
          lastAttemptAt: 0,
          pause: null,
          refusal: null,
          batteries: [],
        });
        this.savedAttemptAt = 0;
        this.restartedAt = 0;
        this.knownPassword = undefined;
        this.session = {};
        this.forgetPace();
        this.values = new Map();
        this.lastRead = undefined;
        changed = true;
      }
    }
    if (email && password) {
      const refusal = this.kept.refusal;
      const other =
        this.knownPassword !== undefined
          ? this.knownPassword !== password
          : Boolean(refusal) && refusal.fp !== credentialsOf(this.kept.salt, email, password);
      this.knownPassword = password;
      if (other) {
        // New credentials: tried at once (a pause asked by the service stays).
        this.kept.refusal = null;
        this.restartedAt = 0;
        this.session = {};
        this.forgetPace();
        changed = true;
      }
    }
    if (changed) {
      await this.saveState();
    }
    // The core keeps the connection status and the Discovery list in memory:
    // a restarted Gladys has lost them, so they are always sent again.
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    if (!fresh) {
      // A (re)connection: every value again at the next read.
      this.gladys.forgetPublishedStates?.();
    }
    await this.discover();
    await this.updateStatus({ starting: true });
    // Always armed, whatever the first read gives: never a dead integration.
    this.timer = this.timers.setInterval(() => this.run(generation, () => this.tick()), TICK);
    this.firstRun = this.run(generation, () => this.tick());
  }

  forgetPace() {
    this.lastAttemptMono = undefined;
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
  }

  async doStop() {
    this.generation += 1;
    if (this.timer !== undefined) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run a job of a generation: nothing after a restart. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return undefined;
    }
    try {
      return await job();
    } catch (err) {
      this.logger.error(`Zinvolt: unexpected error (${err?.name ?? 'Error'})`);
      return undefined;
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Devices --------------------------------------------------------------------

  /** The created Gladys device of a battery key, undefined until the user creates it. */
  createdDevice(key) {
    const id = ids(this.gladys, key).device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === id);
  }

  async discover({ force = false } = {}) {
    const devices = this.config.email
      ? this.kept.batteries.map((b) => buildDevice(this.gladys, b))
      : [];
    const json = JSON.stringify(devices);
    if (!force && json === this.publishedDevices) {
      return;
    }
    this.publishedDevices = json;
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the Zinvolt devices failed: ${err.message}`));
  }

  /** The Discover tab: the batteries known, published again; never a request to the service. */
  async scan() {
    await this.discover({ force: true });
    await this.updateStatus();
  }

  isFresh(entry) {
    return (
      entry !== undefined &&
      this.monotonic() - entry.at <= FRESH_INTERVALS * this.config.pollInterval * 1000
    );
  }

  /** A device just created: the values of the last read now (no new request). */
  async onDeviceCreated(device) {
    await this.publishLast(device);
  }

  async onDeviceUpdated(device) {
    await this.publishLast(device);
  }

  async publishLast(device) {
    const generation = this.generation;
    const battery = this.kept.batteries.find(
      (b) => ids(this.gladys, b.key).device === device?.external_id,
    );
    if (!battery) return;
    const states = this.prepare([battery.key]);
    if (states && generation === this.generation) {
      await this.send(states);
      if (generation === this.generation) await this.updateStatus();
    }
  }

  // --- /data -------------------------------------------------------------------------

  /**
   * Keeps the state in /data when it changed. The instant of the last request
   * is written at most once a minute (the one already written otherwise).
   */
  async saveState() {
    const now = this.now();
    const attempt =
      this.kept.lastAttemptAt !== this.savedAttemptAt &&
      (this.savedAttemptAt === 0 || now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY)
        ? this.kept.lastAttemptAt
        : this.savedAttemptAt;
    const state = {
      salt: this.kept.salt,
      account: this.kept.account,
      lastAttemptAt: attempt,
      pause: this.kept.pause,
      refusal: this.kept.refusal,
      batteries: this.kept.batteries,
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
      this.savedAttemptAt = attempt;
    } catch (err) {
      this.logger.warn(`Saving the Zinvolt state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Reads -------------------------------------------------------------------------

  intervalMs() {
    return this.config.pollInterval * 1000;
  }

  /** The wait after a failure: never faster than a read, doubled up to 30 min. */
  retryWait(failures) {
    const first = Math.max(RETRY_MIN, this.intervalMs());
    return Math.min(first * 2 ** failures, Math.max(RETRY_MAX, first));
  }

  /**
   * The earliest instant (wall clock) of the next read, whatever asks for it.
   * Refused credentials: never by itself (Infinity); the test button may try
   * once per click when the pace allows it.
   */
  nextReadAt({ manual = false } = {}) {
    if (!manual && this.kept.refusal) {
      return Infinity;
    }
    const now = this.now();
    const mono = this.monotonic();
    const at = [now];
    if (this.lastAttemptMono !== undefined) {
      // Never sooner than the interval (the timer looks every 5 s).
      at.push(now + this.lastAttemptMono + this.intervalMs() - mono);
    }
    if (this.retryAtMono > mono) at.push(now + this.retryAtMono - mono);
    if (this.restartedAt > 0) {
      at.push(this.restartedAt + ATTEMPT_SAVE_EVERY + this.intervalMs());
    }
    if (this.kept.pause) at.push(this.kept.pause.until);
    return Math.max(...at);
  }

  due(options) {
    return (
      Boolean(this.config.email && this.config.password) && this.nextReadAt(options) <= this.now()
    );
  }

  /**
   * One look: a read when one is due. A read still running is never doubled,
   * whatever its generation (a reconnection during a read starts no other).
   */
  tick({ manual = false } = {}) {
    if (this.busy) {
      return this.busy;
    }
    if (!this.due({ manual })) {
      return undefined;
    }
    const generation = this.generation;
    this.busy = this.read(generation).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read(generation) {
    const credentials = { email: this.config.email, password: this.config.password };
    const session = this.session;
    const alive = () => generation === this.generation;
    // Recorded first: neither a reconnection, a save nor a restart reads sooner.
    this.lastAttemptMono = this.monotonic();
    this.restartedAt = 0;
    this.kept.lastAttemptAt = this.now();
    await this.saveState();
    let answers;
    try {
      answers = await this.client.readAll(credentials, session, alive);
    } catch (err) {
      await this.failed(err, { credentials, session, alive });
      return;
    }
    if (!alive()) {
      // Late: an old configuration or a restart. Nothing published, no status.
      return;
    }
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
    this.kept.pause = null;
    // The fingerprint of refused credentials goes with the first success.
    this.kept.refusal = null;
    const { list, more } = answers.batteries;
    this.kept.batteries = list;
    const mono = this.monotonic();
    const offline = [];
    const mismatch = [];
    const read = [];
    const values = new Map();
    for (const battery of list) {
      const answer = answers.states.get(battery.key);
      if (answer === undefined) continue;
      const { sn, values: v } = parseCurrentState(answer);
      const label = battery.serial || battery.key;
      if (sn && battery.serial && sn.toUpperCase() !== battery.serial.toUpperCase()) {
        // Another battery answers for this one: nothing of it is published.
        mismatch.push(label);
        continue;
      }
      if (v.online === 0) offline.push(label);
      values.set(battery.key, { values: v, at: mono });
      read.push(battery.key);
    }
    this.values = values;
    this.lastRead = {
      at: this.now(),
      count: list.length,
      missing: answers.missing.map((key) => list.find((b) => b.key === key)?.serial || key),
      offline,
      mismatch,
      more,
    };
    await this.saveState();
    if (!alive()) return;
    const states = this.prepare(read);
    if (states) await this.send(states);
    if (!alive()) return;
    await this.discover();
    if (!alive()) return;
    await this.updateStatus();
  }

  async failed(err, { credentials, session, alive }) {
    const code = err?.code ?? 'error';
    // A late failure of other credentials is dropped; a pause or a refusal of
    // the same credentials is still kept.
    const same =
      this.config.email === credentials.email && this.config.password === credentials.password;
    if (!alive() && !same) return;
    // Our own words only (ZinvoltError codes): never a text of the service, never a secret.
    this.logger.warn(`Zinvolt read failed: ${code}${err?.status ? ` ${err.status}` : ''}`);
    const now = this.now();
    const mono = this.monotonic();
    if (code === 'refused' || code === 'denied') {
      session.token = undefined;
    }
    if (code === 'refused') {
      // Final: no new automatic try (an account may lock after a few).
      const count = (this.kept.refusal?.count ?? 0) + 1;
      this.kept.refusal = {
        count: Math.min(count, 32),
        status: Number.isInteger(err.status) ? err.status : 401,
        fp: credentialsOf(this.kept.salt, credentials.email, credentials.password),
      };
    } else if (code === 'rate_limited' || code === 'server') {
      const count = (this.kept.pause?.count ?? 0) + 1;
      const asked = err.retryAfter ?? PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN, this.intervalMs()), PAUSE_MAX);
      this.kept.pause = {
        until: now + wait,
        count: Math.min(count, 32),
        code,
        status: err.status ?? null,
      };
    } else {
      this.retryAtMono = mono + this.retryWait(this.failures);
      this.failures += 1;
    }
    this.lastError = err;
    await this.saveState();
    if (alive()) {
      await this.updateStatus();
    }
  }

  /** The states of the batteries `keys` with fresh values and a created device. */
  prepare(keys) {
    const states = [];
    for (const key of keys) {
      const entry = this.values.get(key);
      const created = this.createdDevice(key);
      if (!created || !this.isFresh(entry)) continue;
      const features = new Set((created.features ?? []).map((f) => f.external_id));
      states.push(
        ...readStates(ids(this.gladys, key), entry.values).filter((s) =>
          features.has(s.device_feature_external_id),
        ),
      );
    }
    return states.length > 0 ? states : undefined;
  }

  /**
   * The states, within STATES_PER_MINUTE over any 60 s: a batch that would go
   * beyond is not sent this time. The room is taken BEFORE the publication
   * (two publications at once never both pass).
   */
  async send(states) {
    const mono = this.monotonic();
    this.sent = this.sent.filter((s) => mono - s.at < MINUTE);
    const used = this.sent.reduce((sum, s) => sum + s.count, 0);
    if (used + states.length > STATES_PER_MINUTE) {
      this.logger.debug('Zinvolt: values kept for the next read (states per minute)');
      return;
    }
    const entry = { at: mono, count: states.length };
    this.sent.push(entry);
    try {
      const result = await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT });
      if (Number.isInteger(result?.count) && result.count >= 0 && result.count <= states.length) {
        entry.count = result.count;
      }
    } catch (err) {
      this.logger.warn(`Publishing the Zinvolt values failed: ${err.message}`);
    }
  }

  // --- Status ------------------------------------------------------------------------

  async updateStatus({ starting = false } = {}) {
    const { problem } = this.config;
    if (problem) {
      await this.setStatus(false, T.problem[problem]);
      return;
    }
    const now = this.now();
    const mono = this.monotonic();
    const { pause, refusal } = this.kept;
    if (refusal) {
      await this.setStatus(false, T.refused(refusal));
      return;
    }
    if (pause && now < pause.until) {
      await this.setStatus(false, T.paused(pause, pause.until - now));
      return;
    }
    if (this.lastError) {
      const wait = Math.max(0, this.retryAtMono - mono);
      await this.setStatus(false, T.failing(this.lastError, wait));
      return;
    }
    if (!this.lastRead) {
      const at = this.nextReadAt();
      if (starting && at <= now) {
        await this.setStatus(false, T.connecting);
      } else {
        // After a restart, an account read before (no refusal, no pause, no
        // error) is shown connected until its next read.
        await this.setStatus(this.kept.batteries.length > 0, T.waiting(at));
      }
      return;
    }
    const { count, missing, offline, mismatch, more } = this.lastRead;
    const notes = [];
    if (count === 0) notes.push(T.notes.none);
    else if (this.kept.batteries.some((b) => !this.createdDevice(b.key))) {
      notes.push(T.notes.noDevice);
    }
    if (missing.length > 0) notes.push(T.notes.missing(missing));
    if (offline.length > 0) notes.push(T.notes.offline(offline));
    if (mismatch.length > 0) notes.push(T.notes.mismatch(mismatch));
    if (more > 0) notes.push(T.notes.more(more));
    await this.setStatus(true, T.ok(count, notes));
  }

  // --- Configuration screen button -------------------------------------------------

  /**
   * The test button: a read when one is due (the interval passed; refused
   * credentials may be tried again then, once per click), else what is known
   * and when the next read can be. Never a request a pause or the pace forbids.
   */
  async testConnection() {
    const { problem } = this.config;
    if (problem) {
      return T.problem[problem];
    }
    const generation = this.generation;
    const job = this.busy ?? this.tick({ manual: true });
    if (job) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve('late'), TEST_ANSWER_WITHIN);
      });
      try {
        if ((await Promise.race([job.then(() => 'done'), late])) === 'late') {
          return T.test.slow;
        }
      } finally {
        this.timers.clearTimeout(timer);
      }
    }
    if (generation !== this.generation) {
      return T.test.slow;
    }
    const lines = [];
    const fresh =
      this.lastRead !== undefined &&
      this.lastAttemptMono !== undefined &&
      !this.lastError &&
      !this.kept.refusal;
    if (this.kept.refusal) {
      lines.push(T.test.failed({ code: 'refused', status: this.kept.refusal.status }));
    } else if (this.kept.pause && this.now() < this.kept.pause.until) {
      lines.push(T.test.failed(this.kept.pause));
    } else if (this.lastError) {
      lines.push(T.test.failed(this.lastError));
    } else if (fresh) {
      lines.push(T.test.ok(this.lastRead.count));
    }
    if (this.lastRead) lines.push(T.test.lastRead(this.lastRead.at));
    if (!job) lines.push(T.test.notNow(this.nextReadAt({ manual: true })));
    return T.test.lines(lines);
  }
}
