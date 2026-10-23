# Zinvolt

Unofficial integration, not affiliated with Zinvolt. It reads the **Zinvolt
batteries** of your account through the Zinvolt cloud service, with the
e-mail and password you use in the Zinvolt app.

**Never tested with a real device**: it was built from the
[python-zinvolt](https://github.com/joostlek/python-zinvolt) library (the one
of Home Assistant) and its test answers. Please report what you see on a real
battery.

## What you get

One device per battery of the account (10 at most), with:

- state of charge (%);
- charge and discharge power (W), and the battery power as reported (W,
  negative while charging);
- solar power (W) and the power of the socket output (W, as reported);
- online, on grid and dormant states (1 = yes, 0 = no);
- the smart mode (0 = default, 1 = self use, 2 = dynamic, 3 = charged,
  4 = performance, 5 = feed, 6 = custom);
- the settings: maximum output, charge upper and discharge lower limits,
  maximum charge power, standby time, and the system power limit.

**Read-only**: the integration never changes the mode, the output, the
limits nor anything else of the battery.

**No energy counter**: the Zinvolt API gives powers only, no kWh. The
integration adds nothing to the energy monitoring of Gladys and never makes
up an energy from a power.

An offline battery only gets its online state and its settings: its last
live values are never sent again as new ones.

## Configuration

1. In Gladys, open the integration, **Configuration** tab.
2. Enter the **e-mail** and the **password** of your Zinvolt account. The
   password is kept by Gladys in its database, never shown again; it is
   sent only to the Zinvolt service, in its login request, never logged.
3. Keep the **reading interval** at 60 s, or more. One read is one request
   for the list, one per battery, and a login when the session needs one.
4. Save, then create the devices from the **Discover** tab.

## Behaviour

- Never a read faster than the interval: not the test button, not Discovery,
  not a reconnection, not a save of an unchanged form, not a restart (the
  time of the last request is kept in `/data`).
- **Refused e-mail or password**: the reads stop and stay stopped, even after
  a restart; there is no new automatic try (an account could get locked).
  Save the right password, or click **Test the connection** to try once.
- **Too many requests or an error of the service**: the reads pause from 1
  minute to 6 hours (kept in `/data`). A battery that fails alone is only left
  out of that read.
- `/data` never keeps the e-mail, the password nor the session: only a salted
  fingerprint of the account, and of refused credentials while they are
  refused.
- Each answer must name the serial number of the battery it was asked for;
  an answer naming another one is left out.

## Troubleshooting

- The status of the integration says what happened and when the next read is.
- The values look inverted (charging shown as discharging)? The sign of the
  battery power has not been checked on a real battery yet: please report it.
