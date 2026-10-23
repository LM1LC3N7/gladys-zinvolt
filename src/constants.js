// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection' };

/**
 * The external id of a battery: `battery:<serial number>` (upper case), or
 * `battery:id-<identifier>` when the account lists a battery without a
 * readable serial number (src/zinvolt/model.js batteryKey). Forever.
 */
export const EXTERNAL_ID_TYPE = 'battery';

// --- The Zinvolt cloud API (the one python-zinvolt uses) --------------------------
export const API_ORIGIN = 'https://app.zinvolt.com';
export const API_BASE = '/api/public/v2/';
export const PATHS = {
  LOGIN: 'login',
  BATTERIES: 'system/batteries',
  /** `system/<id>/basic/current-state`: charge, powers, mode and settings of one battery. */
  currentState: (id) => `system/${encodeURIComponent(id)}/basic/current-state`,
};
/** The library waits 20 s; an answer of the cloud comes sooner, or not at all. */
export const HTTP_TIMEOUT = 15_000;
/** The answers are a few KiB: more is not an answer of the service. */
export const MAX_BODY_BYTES = 64 * 1024;
/** The batteries of one account read, at most (the others are named in the status). */
export const MAX_BATTERIES = 10;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The reading interval of the form (s): 60 s by default, 60 to 900 (a cloud service). */
export const POLL_DEFAULT = 60;
export const POLL_MIN = 60;
export const POLL_MAX = 900;
/** How often the integration looks whether a read is due (never a read by itself). */
export const TICK = 5 * SECOND;
/**
 * The instant of the last request is written to /data at most once a minute:
 * after a restart, the first read waits this long on top of the interval, so
 * that a container restarting in a loop never reads faster than the interval.
 */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** The states sent in any 60 s, at most (the core refuses a whole batch beyond 300). */
export const STATES_PER_MINUTE = 270;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** Unreachable or odd answer: tried again after the interval at least, doubled up to 30 min. */
export const RETRY_MIN = MINUTE;
export const RETRY_MAX = 30 * MINUTE;
/** HTTP 429 anywhere, 5xx of the login or of the list: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/** Values older than this many intervals are no longer published as current. */
export const FRESH_INTERVALS = 2;

/** A power above this (W) is a glitch (a plug-in battery gives at most a few kW). */
export const POWER_MAX = 20_000;
