// -----------------------------------------------------------------------------
// A fake `fetch` for the Zinvolt client: routes by method and path (relative
// to the API base), records every call, fails loudly on an unexpected one. No
// test touches the network.
// -----------------------------------------------------------------------------

const BASE = 'https://app.zinvolt.com/api/public/v2/';

/**
 * `routes` maps "METHOD path" ("GET system/batteries") to handler(call) ->
 * Response, or throw. `call`: `{ url, method, path, init, body }`.
 */
export function createFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    if (!url.startsWith(BASE)) {
      throw new Error(`Unexpected origin in a test: ${url}`);
    }
    const path = url.slice(BASE.length);
    const method = init.method ?? 'GET';
    const call = {
      url,
      method,
      path,
      init,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (typeof handler !== 'function') {
      throw new Error(`Unexpected Zinvolt call in a test: ${method} ${path}`);
    }
    return handler(call);
  };
  return { fetch: fetchImpl, calls, routes };
}

/** What fetch throws when the service does not answer in time. */
export const timeoutError = () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
};

/** What fetch throws when nothing answers. */
export function refusedError() {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ECONNREFUSED' };
  return err;
}
