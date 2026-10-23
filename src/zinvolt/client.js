// -----------------------------------------------------------------------------
// The Zinvolt cloud API (https://app.zinvolt.com/api/public/v2/), after
// python-zinvolt (joostlek, MIT, see THIRD_PARTY_NOTICES.md), the library of
// the Home Assistant integration: a login with the e-mail and password of the
// Zinvolt account gives a token, sent as `Authorization: Bearer` to the read
// endpoints.
//
// READ-ONLY: the login (a POST, the only one) and GET requests of PATHS. No
// method here changes anything (no smart mode, no output limit, no charge
// threshold): there is none to call.
//
// The password only goes in the body of the login request; the token only in
// the header of a request to the same origin; a redirect is never followed.
// No User-Agent of our own (Node's fetch, never an imitation of the app).
// Errors carry our own codes, never a text of the service, never a URL, never
// the password nor the token. Every body is bounded (64 KiB), read into one
// buffer.
// -----------------------------------------------------------------------------

import { API_BASE, API_ORIGIN, HTTP_TIMEOUT, MAX_BODY_BYTES, PATHS } from '../constants.js';
import { isCurrentState, parseBatteries, tokenOf } from './model.js';

export class ZinvoltError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'refused'|'denied'|'http'|'server'|'rate_limited'|
   *   'too_large'|'not_json'|'unknown_answer'} code
   *   `refused`: the login refuses the e-mail or password; `denied`: a read
   *   endpoint refuses a token the login just gave.
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'ZinvoltError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

function networkError(err) {
  if (err instanceof ZinvoltError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new ZinvoltError(timeout ? 'timeout' : 'unreachable');
}

/**
 * The body, read into ONE buffer of at most `limit` bytes (no buffer kept per
 * chunk, no concatenation): a longer one is not an answer of the service.
 */
export async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const buffer = Buffer.allocUnsafe(limit);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (size + value.byteLength > limit) {
      await reader.cancel().catch(() => {});
      throw new ZinvoltError('too_large');
    }
    buffer.set(value, size);
    size += value.byteLength;
  }
  return buffer.toString('utf8', 0, size);
}

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

/** The statuses of a login that refuses the credentials (final, never tried again by itself). */
const LOGIN_REFUSED = new Set([400, 401, 403, 422]);

export class ZinvoltClient {
  constructor({
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  } = {}) {
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
  }

  /**
   * One request of `path` (relative to the API base): its parsed JSON. 401/403
   * are `denied` here (the login turns them into `refused`).
   */
  async request(path, { method = 'GET', token, body } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    let text;
    try {
      response = await this.fetch(`${API_ORIGIN}${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect is never followed: the password and the token stay on this origin.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeout),
      });
      // The body can fail too (timeout, connection cut): same errors.
      text = await readBounded(response, MAX_BODY_BYTES);
    } catch (err) {
      throw networkError(err);
    }
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new ZinvoltError('denied', { status });
    }
    if (status === 429 || status >= 500) {
      throw new ZinvoltError(status === 429 ? 'rate_limited' : 'server', {
        status,
        retryAfter: retryAfterOf(response, this.now),
      });
    }
    if (status < 200 || status >= 300) {
      throw new ZinvoltError('http', { status });
    }
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new ZinvoltError('not_json');
    }
    if (answer === null || typeof answer !== 'object') {
      throw new ZinvoltError('unknown_answer');
    }
    return answer;
  }

  /** The login: the token, or `refused` (400/401/403/422) with its status. */
  async login(email, password) {
    let answer;
    try {
      answer = await this.request(PATHS.LOGIN, { method: 'POST', body: { email, password } });
    } catch (err) {
      if (err.code === 'denied' || (err.code === 'http' && LOGIN_REFUSED.has(err.status))) {
        throw new ZinvoltError('refused', { status: err.status });
      }
      throw err;
    }
    const token = tokenOf(answer);
    if (!token) {
      throw new ZinvoltError('unknown_answer');
    }
    return token;
  }

  /**
   * A GET with the token of `session` (`{ token }`, kept in memory by the
   * app). Without a token, a login first. A token refused by an endpoint
   * (401/403) that did not come from a login of this very read is renewed
   * once (`renewed`, shared by the read): never a loop, never more than one
   * login per read. A token just given and refused is `denied`.
   */
  async authed(path, credentials, session, state) {
    if (!session.token) {
      session.token = await this.login(credentials.email, credentials.password);
      state.loggedIn = true;
    }
    try {
      return await this.request(path, { token: session.token });
    } catch (err) {
      if (err.code !== 'denied' || state.loggedIn) {
        throw err;
      }
      session.token = undefined;
      session.token = await this.login(credentials.email, credentials.password);
      state.loggedIn = true;
      return this.request(path, { token: session.token });
    }
  }

  /**
   * One read: the list of the batteries first (required: an error there
   * stops the read), then the current state of each one. A battery whose
   * state fails with an error of the service (5xx, 401/403, an odd answer)
   * is only left out (`missing`); a 429 stops the read; a network failure
   * stops the remaining requests (kept: what came). `alive()` false (a
   * restart, a new configuration) stops between two requests.
   * @returns {Promise<{ batteries: { list, more }, states: Map<string, object>,
   *   missing: string[] }>}
   */
  async readAll(credentials, session, alive = () => true) {
    const state = { loggedIn: false };
    const batteries = parseBatteries(
      await this.authed(PATHS.BATTERIES, credentials, session, state),
    );
    if (!batteries) {
      throw new ZinvoltError('unknown_answer');
    }
    const result = { batteries, states: new Map(), missing: [] };
    const list = batteries.list;
    for (const [i, battery] of list.entries()) {
      if (!alive()) {
        break;
      }
      try {
        const answer = await this.request(PATHS.currentState(battery.id), {
          token: session.token,
        });
        if (!isCurrentState(answer)) {
          throw new ZinvoltError('unknown_answer');
        }
        result.states.set(battery.key, answer);
      } catch (err) {
        if (err.code === 'rate_limited') {
          throw err;
        }
        result.missing.push(battery.key);
        if (err.code === 'timeout' || err.code === 'unreachable') {
          for (const rest of list.slice(i + 1)) result.missing.push(rest.key);
          break;
        }
      }
    }
    return result;
  }
}
