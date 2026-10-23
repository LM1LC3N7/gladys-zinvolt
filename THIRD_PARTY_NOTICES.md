# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## python-zinvolt (joostlek/python-zinvolt)

<https://github.com/joostlek/python-zinvolt>, the asynchronous Python client
of the Zinvolt API (published on PyPI as `zinvolt`, used by the Zinvolt
integration of Home Assistant). Release v1.1.0, branch `master` at commit
6f76d7a (2026-10-21). MIT License.

Ported to JavaScript in `src/zinvolt/client.js` and `src/zinvolt/model.js`:
the base address of the API (`https://app.zinvolt.com/api/public/v2/`), the
login with the e-mail and password of the account and its Bearer token, the
read endpoints `system/batteries` and `system/<id>/basic/current-state`, the
401/403 answers of a refused token, the meaning of the keys of the answers
(`models.py`: state of charge, solar power, socket output, power limit, grid
and dormancy flags, smart modes, global settings). The test answers of
`test/fixtures/zinvolt.js` are shortened from its `tests/fixtures/*.json`.
Changed here: read-only (nothing that writes is ported: no smart mode, no
output limit, no threshold, no standby time), no User-Agent of our own, the
token renewed at most once per read, a missing or odd value is never read as
0, a redirect is never followed, and the answers are bounded.

Its license notice, reproduced as it appears in its `LICENSE.md` file:

```
MIT License

Copyright (c) 2026 Joost Lekkerkerker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-sonnen and gladys-air-q

The structure of the integration (pace kept in `/data`, generations, pauses,
the states budget, the test button) comes from the sibling integration
[gladys-sonnen](https://github.com/LM1LC3N7/gladys-sonnen); the fingerprint of
refused secrets kept in `/data` (`src/store.js`) from
[gladys-air-q](https://github.com/LM1LC3N7/gladys-air-q). Same project,
Apache-2.0.
