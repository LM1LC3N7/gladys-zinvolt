# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Reading of the Zinvolt batteries of an account through the Zinvolt cloud
  API, as the python-zinvolt library does: login with the e-mail and password,
  list of the batteries, current state of each one, every 60 s by default
  (60 to 900 s). Read-only: no mode, output or limit is ever sent.
- One device per battery (10 at most), its external id from the serial
  number: state of charge, the signed power at the socket (the exchange of
  the device with the home, solar included; the sign of Home Assistant,
  `0 - pso`, still to confirm; no battery charge or discharge power yet),
  solar power, power given to the home through the socket
  (`home-output-sensor`),
  power limit, online, on grid and dormant states, smart mode, maximum
  output, charge upper and discharge lower limits, maximum charge power,
  standby time. No energy index: the API has no energy counter.
- A battery offline, or whose online flags are missing or contradict each
  other, only gets its online state and its settings; an answer naming
  another serial number is left out; a battery listed without a readable
  identifier is left out and counted in the status.
- Never a read faster than the interval: not the test button, Discovery, a
  reconnection, a save of an unchanged configuration nor a restart (the last
  request is kept in `/data`, written at most once a minute). A read that
  ends after a restart or a new configuration publishes nothing.
- Refused credentials stop the reads for good, kept in `/data` (a salted
  fingerprint of the refused credentials only, erased by the first success):
  no automatic try, the test button tries once per click, new credentials are
  tried at once; saving the same ones again tries nothing. An account whose
  access to the API is refused right after its login is stopped the same
  way. An expired session gets one new login per read at most (on the list
  only: a battery state refusing the token the list just accepted is only
  left out, never a login).
  HTTP 429 and 5xx of the login or the list pause the reads from 1 minute to
  6 hours; an error of one battery only leaves it out. Answers bounded to
  64 KiB, no redirect followed, no secret logged nor kept in `/data`.
- "Test the connection" button.
- Documentation in English and French; `LICENSE` (Apache-2.0) and
  `THIRD_PARTY_NOTICES.md` (MIT notice of python-zinvolt), shipped in the
  image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-zinvolt/commits/main
