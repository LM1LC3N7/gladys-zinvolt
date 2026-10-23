# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real Zinvolt account and battery:
      login, test button, device creation, the values.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Run the store validator (`npx github:GladysAssistant/integration-store .`):
      the development agent could not run it.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real battery (built without one)

- [ ] The sign of `pbt` (battery power): taken as < 0 charging (the library's
      fixture: -19 W at 100 % with no solar, the stand-by draw). Not in the
      library's model: only in its test answer.
- [ ] The sign and meaning of `pso` (socket output), published as reported.
- [ ] The status of a wrong password at the login (401 in the library's
      tests; 400, 403 and 422 are taken as refusals too).
- [ ] How long the token lives (the fixture JWT has no `exp`): renewed on a
      401, once per read at most.
- [ ] Whether `current-state` lags when the battery loses its connection
      (`connection-status` of the API has the last upload time, not read in
      v1).
- [ ] Rate limits of the API (none documented).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-zinvolt:0.1.0`), as
  for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: python-zinvolt (joostlek, MIT, release v1.1.0, `master`
  at commit 6f76d7a, LICENSE.md checked: MIT, "Copyright (c) 2026 Joost
  Lekkerkerker"), cloned read-only in `_ref/zinvolt`, ported to JavaScript:
  the API base, the login and its Bearer token, the two read endpoints, the
  keys and their meaning. A young library (created in 2026-02): the fixtures
  of its tests are the only reference of the answers. The SDK stays the only
  runtime dependency. Structure from gladys-sonnen (pace, generations,
  pauses, states budget, test button), refused-secret fingerprint from
  gladys-air-q; the template's demo files were removed (`git rm`).
- **Read-only (v1)**: no `onSetValue`; nothing of `set_smart_mode`,
  `set_max_output`, `set_lower_threshold`, `set_upper_threshold`,
  `set_standby_time`, `set_max_charge_power` is ported (the client has no
  method for it, tested). Changing the mode or the output of a battery is
  left for a later version, as buttons behind options disabled by default.
- **No energy index**: the API gives no energy counter (kWh), only powers;
  no energy is ever made up from a power (a sum of samples would drift and
  be counted by the core). No `index`, no `daily-*`, never
  `publishEnergyConsumption`. The powers are `battery-storage` (charge,
  discharge, level), `energy-production-sensor` / `power` (solar) or plain
  sensors (`unknown`, unit in the name).
- **External id**: `battery:<serial number>` in upper case, from
  `serial_number` of the list (letters, digits, `-`, `_`, 4 to 40). Without a
  readable serial number, the readable fallback `battery:id-<identifier>`
  (the identifier of the URLs, lower case). This rule fixes the external ids:
  never change it.
- **Identity at every read**: each current state must name (`sn`) the serial
  number of the battery it was asked for; another one is left out (nothing
  published, noted in the status); an unreadable `sn` is not "another
  battery".
- **10 batteries at most** per account (16 states each, within the 270
  states per minute at 60 s); the others are counted in the status.
- **Offline**: `onlineStatus` other than `ONLINE` gives no live value (the API
  then sends only the status); the online state and the settings are still
  published. Never a stale value published as new.
- **Pace**: one read = the list + one state per battery (+ a login when
  needed), 60 s by default (60-900 s, a cloud service). The timer looks every
  5 s whether a read is due; nothing reads sooner than the last request + the
  interval (monotonic clock): not the test button, not Discovery, not a
  (re)connection, not a save of an unchanged form, not a restart (the last
  request is written to `/data` at most once a minute, so after a restart the
  first read waits that instant + one minute + the interval). New credentials
  or another account are read at once. A read running is never doubled; a
  read that ends after a restart or a new configuration publishes nothing and
  sets no status.
- **Credentials refused** (login 400/401/403/422): final, as in the lot 12
  rule (an account could get locked by repeated tries): `{ count, status,
fp }` in `/data`, never tried again by itself, not after a restart either;
  the test button may try once per click when the pace allows it; saving
  other credentials tries at once. `fp` is a salted scrypt fingerprint
  (random salt per file) of the refused e-mail and password only, erased by
  the first success: nothing in `/data` can confirm a working password.
- **Token**: kept in memory only (never in `/data`), reused across reads and
  reconnections; dropped when the credentials change. A 401/403 of the list
  with an old token gives one new login in the same read, never more; a token
  refused right after its login is `denied` (a plain failure, spaced
  retries), not a refusal of the credentials. The token's `exp` is not read
  (no clock of the service compared to ours).
- **429 / 5xx**: of the login or the list (or a 429 anywhere): pause
  `{ until, count, code, status }` in `/data`, from Retry-After or 1 min
  doubled, 1 min - 6 h, at least the interval, end capped when read back. A
  5xx, a 401/403 or an odd answer of one battery only leaves it out (named in
  the status); a network failure stops the remaining requests of the read.
- **Unreachable or odd answer**: retried after the interval (1 min at
  least), doubled up to 30 min.
- **Account in `/data`**: a salted fingerprint of the e-mail (no case), never
  the e-mail; another account clears the pace, the pause, the refusal and the
  batteries (the devices stay in Gladys).
- **States per minute**: a sliding budget of 270 states over 60 s, taken
  before each publication.
- **Device created**: it gets the values of the last read at once (if fresh:
  two intervals), never a new request.
- **Hostile answers**: bodies bounded to 64 KiB, read into one buffer, JSON
  parsed once, own keys only, strict numbers, ranges checked; the identifier
  of a battery checked by pattern before it goes in a URL (and encoded);
  names and serial numbers checked by pattern before being shown.
- **No custom User-Agent**, no imitation of the app (the library sends its
  own `python-zinvolt/1`; Node's fetch sends its own). No Bluetooth. No
  network discovery.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

## Ideas

- The photovoltaic inputs one by one (`basic/pv-data`), the units and their
  firmware (`unit`), the last upload time (`connection-status`).
- Commands (smart mode, maximum output) as buttons behind options disabled by
  default, once tested on a real battery.
