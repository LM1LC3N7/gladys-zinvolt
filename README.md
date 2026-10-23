# gladys-zinvolt

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for
**Zinvolt** batteries. It reads the batteries of a Zinvolt account through the
Zinvolt cloud service (e-mail and password of the app) every 60 seconds:
state of charge, charge and discharge power, solar power, socket output,
online and grid state, smart mode and settings. **Read-only**: it never
changes the mode, the output nor the charge limits. No energy counter (the
API gives powers only).

**Never tested with a real device.** Not affiliated with Zinvolt.

- User guide: [English](docs/en.md), [français](docs/fr.md).
- Requirements: Gladys 5.2.0 or later, a Zinvolt account.

## How it works

- Every read: a login when the session needs one (`POST login`), then
  `GET system/batteries` and `GET system/<id>/basic/current-state` for each
  battery, with the Bearer token, as the
  [python-zinvolt](https://github.com/joostlek/python-zinvolt) library (MIT)
  does. Ported to JavaScript, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Never a read faster than the interval, across reconnections, saves and
  restarts (`/data`); refused credentials stop the reads for good (kept in
  `/data`, no automatic try); 429 and 5xx pause the reads; nothing secret is
  logged nor kept in `/data`.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run audit
```

See [CLAUDE.md](CLAUDE.md) for the project rules, [TODO.md](TODO.md) for the
decisions and what is left to check on a real battery.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
