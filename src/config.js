// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// The password is a secret: it is never logged, never shown, never written to
// /data (only a salted fingerprint of REFUSED credentials, src/store.js), and
// only ever sent to the login endpoint of the Zinvolt service.
// -----------------------------------------------------------------------------

import { POLL_DEFAULT, POLL_MAX, POLL_MIN } from './constants.js';

/** Whether a text holds a control character (C0 or DEL). */
const hasControl = (text) =>
  [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** An e-mail address, loosely: one @, no space, no control character. */
const EMAIL = { test: (t) => /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(t) && !hasControl(t) };

/** A password: 1 to 256 characters, no control character (it goes in a JSON body). */
const PASSWORD = { test: (t) => t.length >= 1 && t.length <= 256 && !hasControl(t) };

/** The reading interval (s): a number from 60 to 900, else 60. */
function pollOf(raw) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return POLL_DEFAULT;
  }
  return Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(value)));
}

/**
 * `{ email, password, pollInterval, problem }`: `email` and `password` are
 * undefined when missing or invalid; `problem` is 'email_missing',
 * 'email_invalid', 'password_missing', 'password_invalid' or undefined. The
 * e-mail is compared without case (the same account).
 */
export function normalizeConfig(raw = {}) {
  const emailText = typeof raw?.email === 'string' ? raw.email.trim() : '';
  // A password is taken as typed (spaces included), only checked.
  const passwordText = typeof raw?.password === 'string' ? raw.password : '';
  let problem;
  if (emailText === '') problem = 'email_missing';
  else if (!EMAIL.test(emailText)) problem = 'email_invalid';
  else if (passwordText === '') problem = 'password_missing';
  else if (!PASSWORD.test(passwordText)) problem = 'password_invalid';
  return {
    email: problem === 'email_missing' || problem === 'email_invalid' ? undefined : emailText,
    password: problem ? undefined : passwordText,
    pollInterval: pollOf(raw?.poll_interval),
    problem,
  };
}
