# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the **Zinvolt batteries** of an account through the Zinvolt cloud API
(`https://app.zinvolt.com/api/public/v2/`): `POST login` (e-mail and password,
gives a Bearer token), `GET system/batteries`, `GET system/<id>/basic/current-state`.
Ported from [python-zinvolt](https://github.com/joostlek/python-zinvolt) (MIT,
see `THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with Zinvolt.
**Read-only**: never `onSetValue`, never a write endpoint. Sibling:
`gladys-sonnen` (its structure).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "pace"    # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        ZinvoltApp: pace, reads, refusal, pauses, devices, test button
src/zinvolt/client.js             the only HTTP access (login + GET, bounded body, errors in our words)
src/zinvolt/model.js              the answers -> values (pure)
src/store.js                      what /data keeps across restarts (no secret)
src/devices.js                    the devices, feature keys, catalog, states (pure)
src/config.js                     e-mail, password and interval, normalized
src/constants.js                  paths, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Read-only.** No `onSetValue`; the login is the only POST, every other
  request a GET of `PATHS` (`test/client.test.js` checks it). A command, if
  one is ever added, is a `button` disabled by default behind an option,
  never a `switch`.
- **Secrets**: the password, the e-mail and the token are never logged, never
  shown, never written to `/data` (only salted fingerprints: the account, and
  REFUSED credentials, erased by the first success); the password only goes
  to the login, the token only to the API origin; no redirect followed. The
  password field is described as "kept by Gladys in its database, never
  shown again".
- **Pace**: never a read faster than the interval, whatever asks (test
  button, Discovery, connection, save, restart: `/data` keeps the last
  request, written at most once a minute). A read of an old generation
  publishes nothing and sets no status.
- **Refused credentials are final**: no automatic try, not after a restart
  either; only the test button (once per click, paced) or new credentials.
  So is a token refused by the list right after its login (`denied`). The
  token is renewed at most once per read, and only for the list: a battery
  state refusing the token the list just accepted never triggers a login.
- **No battery power**: `socket_power` (`0 - pso`, as Home Assistant, sign to
  confirm) is the exchange at the socket, solar included; never a battery
  power nor typed charge/discharge powers until `pbt` is understood.
- **No energy index**: the API has no energy counter; never an `index`,
  `daily-*` nor `publishEnergyConsumption`, never an energy made up from a
  power.
- **Errors**: 429/5xx of the login or the list pause from 1 min to 6 h (kept
  in `/data`); one battery failing only leaves it out.
- **Hostile answers**: bodies bounded to 64 KiB in one buffer, own keys only,
  strict numbers, ranges checked. Never a text of the service in a message.
- **External ids are forever**: `battery:<serial>` (rule in
  `src/zinvolt/model.js` batteryKey), the `FEATURE` keys of `src/devices.js`,
  the manifest keys. A device published again never loses a feature (the
  whole catalog, always).
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY` in the core
  (`test/manifest.test.js`).
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/zinvolt-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
- **User-facing text** is bilingual (English and French), kept in sync. Files
  are UTF-8 without BOM nor control byte (`test/encoding.test.js`, sources
  included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
