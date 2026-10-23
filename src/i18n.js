// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a text of the service, the e-mail, the password nor the token: only
// our own words, error codes, HTTP statuses and battery serial numbers.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** "18:02:05 UTC": an instant, never in the local time of a container. */
export const clock = (at) => `${new Date(at).toISOString().slice(11, 19)} UTC`;

/** Our words for an error code of src/zinvolt/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  refused: { en: 'e-mail or password refused', fr: 'e-mail ou mot de passe refusé' },
  denied: {
    en: 'account accepted but access to the API refused',
    fr: 'compte accepté mais accès à l’API refusé',
  },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  server: { en: 'error of the Zinvolt service', fr: 'erreur du service Zinvolt' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_json: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: { en: 'unexpected answer', fr: 'réponse inattendue' },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    ['http', 'server', 'refused', 'denied', 'rate_limited'].includes(err?.code) &&
    Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const sentences = (lang, list) => list.map((n) => n[lang]).join(' ');
const both = (list) => ({ en: sentences('en', list), fr: sentences('fr', list) });
const names = (list) => list.join(', ');

export const T = {
  problem: {
    email_missing: {
      en: 'Enter the e-mail and the password of your Zinvolt account in the configuration.',
      fr: 'Saisissez l’e-mail et le mot de passe de votre compte Zinvolt dans la configuration.',
    },
    email_invalid: {
      en: 'The e-mail is not valid: enter the address of your Zinvolt account.',
      fr: 'L’e-mail n’est pas valide : saisissez l’adresse de votre compte Zinvolt.',
    },
    password_missing: {
      en: 'Enter the password of your Zinvolt account.',
      fr: 'Saisissez le mot de passe de votre compte Zinvolt.',
    },
    password_invalid: {
      en: 'The password is not valid (1 to 256 characters, no line break): type it again.',
      fr: 'Le mot de passe n’est pas valide (1 à 256 caractères, sans retour à la ligne) : saisissez-le de nouveau.',
    },
  },
  connecting: { en: 'Reading the Zinvolt account…', fr: 'Lecture du compte Zinvolt…' },
  /** Not read yet in this start: the next read. */
  waiting: (at) => ({
    en: `Zinvolt: next read at ${clock(at)}.`,
    fr: `Zinvolt : prochaine lecture à ${clock(at)}.`,
  }),
  refused: (refusal) =>
    refusal.kind === 'denied'
      ? {
          en: `Zinvolt accepts the account but refuses its access to the API (HTTP ${refusal.status}). Reads stopped, no new automatic try: check the account in the Zinvolt app, then click "Test the connection" to try once, or enter other credentials (saving the same ones again tries nothing).`,
          fr: `Zinvolt accepte le compte mais refuse son accès à l’API (HTTP ${refusal.status}). Lectures arrêtées, aucun nouvel essai automatique : vérifiez le compte dans l’application Zinvolt, puis cliquez sur « Tester la connexion » pour un essai, ou saisissez d’autres identifiants (réenregistrer les mêmes ne relance rien).`,
        }
      : {
          en: `Zinvolt refuses the e-mail or the password (HTTP ${refusal.status}). Reads stopped, no new automatic try: enter another password (saving the same one again tries nothing), or click "Test the connection" to try once.`,
          fr: `Zinvolt refuse l’e-mail ou le mot de passe (HTTP ${refusal.status}). Lectures arrêtées, aucun nouvel essai automatique : saisissez un autre mot de passe (réenregistrer le même ne relance rien), ou cliquez sur « Tester la connexion » pour un essai.`,
        },
  failing: (err, wait) => ({
    en: `The Zinvolt account could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
    fr: `Le compte Zinvolt n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
  }),
  paused: (pause, wait) => ({
    en: `The Zinvolt service asks to wait (${reason(pause).en}): reads paused, new try in ${delay(wait).en}.`,
    fr: `Le service Zinvolt demande d’attendre (${reason(pause).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
  }),
  ok: (count, notes = []) =>
    both([
      {
        en: `Zinvolt account read: ${count} battery(ies).`,
        fr: `Compte Zinvolt lu : ${count} batterie(s).`,
      },
      ...notes,
    ]),
  notes: {
    none: {
      en: 'No battery in this account.',
      fr: 'Aucune batterie dans ce compte.',
    },
    noDevice: {
      en: 'Create the devices from the "Discover" tab to receive their values.',
      fr: 'Créez les appareils depuis l’onglet « Découverte » pour recevoir leurs valeurs.',
    },
    missing: (list) => ({
      en: `Not read this time: ${names(list)}; the other values are up to date.`,
      fr: `Non lu cette fois : ${names(list)} ; les autres valeurs sont à jour.`,
    }),
    offline: (list) => ({
      en: `Offline or online state unknown for Zinvolt: ${names(list)} (no live value sent).`,
      fr: `Hors ligne ou état en ligne inconnu pour Zinvolt : ${names(list)} (aucune valeur en direct envoyée).`,
    }),
    skipped: (count) => ({
      en: `${count} battery(ies) of the account left out: unreadable identifier.`,
      fr: `${count} batterie(s) du compte laissée(s) de côté : identifiant illisible.`,
    }),
    mismatch: (list) => ({
      en: `Answer naming another serial number, left out: ${names(list)}.`,
      fr: `Réponse au nom d’un autre numéro de série, laissée de côté : ${names(list)}.`,
    }),
    more: (count) => ({
      en: `${count} more battery(ies) not read (10 at most).`,
      fr: `${count} batterie(s) de plus non lue(s) (10 au plus).`,
    }),
  },
  test: {
    ok: (count) => ({
      en: `Zinvolt account accepted: ${count} battery(ies).`,
      fr: `Compte Zinvolt accepté : ${count} batterie(s).`,
    }),
    failed: (err) => ({
      en: `Zinvolt: ${reason(err).en}.`,
      fr: `Zinvolt : ${reason(err).fr}.`,
    }),
    /** The button never reads sooner than the pace: what is known, and when the next read can be. */
    notNow: (at) =>
      Number.isFinite(at)
        ? {
            en: `Not asked now (never faster than the reading interval or a pause): next read possible at ${clock(at)}.`,
            fr: `Non interrogé maintenant (jamais plus vite que l’intervalle de lecture ou une pause) : prochaine lecture possible à ${clock(at)}.`,
          }
        : { en: 'Not asked now.', fr: 'Non interrogé maintenant.' },
    lastRead: (at) => ({
      en: `Last read at ${clock(at)}.`,
      fr: `Dernière lecture à ${clock(at)}.`,
    }),
    slow: {
      en: 'The Zinvolt service is slow to answer: look at the integration status in a minute.',
      fr: 'Le service Zinvolt tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
    lines: (lines) => both(lines),
  },
};
