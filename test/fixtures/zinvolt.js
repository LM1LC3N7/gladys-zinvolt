// -----------------------------------------------------------------------------
// A fake Zinvolt account: the answers shortened from the test fixtures of
// python-zinvolt (MIT, `tests/fixtures/*.json`), with a second battery.
// -----------------------------------------------------------------------------

export const NOW = Date.parse('2026-10-23T10:00:00Z');
export const EMAIL = 'someone@example.com';
export const PASSWORD = 'S3cret pass!';
export const ID1 = 'a125ef17-6bdf-45ad-b106-ce54e95e4634';
export const ID2 = 'b225ef17-6bdf-45ad-b106-ce54e95e4635';
export const SN1 = 'ZVG011025120088';
export const SN2 = 'ZVG011025110053';
/** A JWT of the library's fixture shape (header.payload.signature), fake. */
export const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
export const TOKEN2 = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0d28ifQ.c2lnbmF0dXJlMg';

export const json = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const batteriesAnswer = (list = [[ID1, SN1, 'Zinvolt Batterij']]) => ({
  batteries: list.map(([id, serial_number, name]) => ({ id, name, serial_number })),
});

export const onlineState = (sn = SN1, power = {}) => ({
  sn,
  name: sn,
  onlineStatus: 'ONLINE',
  currentPower: {
    soc: 100,
    coc: 4,
    pbt: -19,
    ppv: 0,
    pso: -19,
    onGrid: true,
    onlineStatus: 'ONLINE',
    smp: 800,
    isDormancy: false,
    ...power,
  },
  smartMode: 'CHARGED',
  globalSettings: {
    maxOutput: 800,
    maxOutputLimit: 800,
    maxOutputUnlocked: false,
    batHighCap: 100,
    batUseCap: 10,
    maxChargePower: 800,
    standbyTime: 60,
  },
});

export const offlineState = (sn = SN2) => ({
  sn,
  name: sn,
  onlineStatus: 'OFFLINE',
  currentPower: { onlineStatus: 'OFFLINE' },
  smartMode: 'CHARGED',
  globalSettings: {
    maxOutput: 800,
    maxOutputLimit: 800,
    maxOutputUnlocked: false,
    batHighCap: 100,
    batUseCap: 10,
    maxChargePower: 2000,
    standbyTime: 60,
  },
});

/**
 * The routes of an account. `state` may be changed by a test: `token` (the
 * one the service accepts), `login` (a handler replacing the login), `hold`
 * (a promise the list waits for), `batteries`, `states` (by id).
 */
export function account(options = {}) {
  const state = {
    token: TOKEN,
    issued: TOKEN,
    batteries: batteriesAnswer(),
    states: { [ID1]: () => json(onlineState()) },
    ...options,
  };
  const authed = (call) => call.init.headers.Authorization === `Bearer ${state.token}`;
  const routes = {
    'POST login': (call) => {
      if (state.login) return state.login(call);
      if (call.body.email !== 'someone@example.com' || call.body.password !== 'S3cret pass!') {
        return json({ message: 'Invalid credentials', code: 401 }, 401);
      }
      return json({ token: state.issued });
    },
    'GET system/batteries': async (call) => {
      if (state.hold) await state.hold;
      if (!authed(call)) return json({ message: 'Unauthenticated.' }, 401);
      return typeof state.batteries === 'function' ? state.batteries() : json(state.batteries);
    },
  };
  for (const id of [ID1, ID2]) {
    routes[`GET system/${id}/basic/current-state`] = (call) => {
      if (!authed(call)) return json({ message: 'Unauthenticated.' }, 401);
      const handler = state.states[id];
      return handler ? handler(call) : json({ message: 'Device not exist' }, 404);
    };
  }
  routes.state = state;
  return routes;
}
