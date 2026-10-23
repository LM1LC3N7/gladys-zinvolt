# Zinvolt

Intégration non officielle, sans lien avec Zinvolt. Elle lit les **batteries
Zinvolt** de votre compte par le service cloud de Zinvolt, avec l’e-mail et
le mot de passe que vous utilisez dans l’application Zinvolt.

**Jamais testé avec un vrai appareil** : l’intégration a été construite à
partir de la bibliothèque
[python-zinvolt](https://github.com/joostlek/python-zinvolt) (celle de Home
Assistant) et de ses réponses de test. Merci de signaler ce que vous voyez
sur une vraie batterie.

## Ce que vous obtenez

Un appareil par batterie du compte (10 au plus), avec :

- le niveau de charge (%) ;
- les puissances de charge et de décharge (W), et la puissance de la
  batterie telle que reçue (W, négative pendant la charge) ;
- la puissance solaire (W) et la puissance de la sortie prise (W, telle que
  reçue) ;
- les états en ligne, sur le réseau et en veille (1 = oui, 0 = non) ;
- le mode intelligent (0 = défaut, 1 = autoconsommation, 2 = dynamique,
  3 = chargé, 4 = performance, 5 = injection, 6 = personnalisé) ;
- les réglages : sortie maximale, limites haute de charge et basse de
  décharge, puissance de charge maximale, délai de veille, et la limite de
  puissance du système.

**Lecture seule** : l’intégration ne change jamais le mode, la sortie, les
limites ni rien d’autre de la batterie.

**Aucun compteur d’énergie** : l’API Zinvolt ne donne que des puissances,
aucun kWh. L’intégration n’ajoute rien au suivi énergétique de Gladys et ne
fabrique jamais d’énergie à partir d’une puissance.

Une batterie hors ligne ne reçoit que son état en ligne et ses réglages : ses
dernières valeurs en direct ne sont jamais renvoyées comme nouvelles.

## Configuration

1. Dans Gladys, ouvrez l’intégration, onglet **Configuration**.
2. Saisissez l’**e-mail** et le **mot de passe** de votre compte Zinvolt. Le
   mot de passe est gardé par Gladys dans sa base, jamais réaffiché ; il est
   envoyé seulement au service Zinvolt, dans sa requête de connexion, jamais
   journalisé.
3. Gardez l’**intervalle de lecture** à 60 s, ou plus. Une lecture, c’est une
   requête pour la liste, une par batterie, et une connexion quand la session
   en demande une.
4. Enregistrez, puis créez les appareils depuis l’onglet **Découverte**.

## Fonctionnement

- Jamais de lecture plus rapide que l’intervalle : ni le bouton de test, ni la
  Découverte, ni une reconnexion, ni l’enregistrement d’un formulaire
  inchangé, ni un redémarrage (l’heure de la dernière requête est gardée dans
  `/data`).
- **E-mail ou mot de passe refusé** : les lectures s’arrêtent et restent
  arrêtées, même après un redémarrage ; aucun nouvel essai automatique (un
  compte pourrait être bloqué). Enregistrez le bon mot de passe, ou cliquez
  sur **Tester la connexion** pour un essai.
- **Trop de requêtes ou erreur du service** : les lectures se mettent en pause
  de 1 minute à 6 heures (gardée dans `/data`). Une batterie qui échoue seule
  est seulement laissée de côté pour cette lecture.
- `/data` ne garde jamais l’e-mail, le mot de passe ni la session : seulement
  une empreinte salée du compte, et des identifiants refusés tant qu’ils le
  sont.
- Chaque réponse doit porter le numéro de série de la batterie demandée ; une
  réponse au nom d’une autre est laissée de côté.

## Dépannage

- L’état de l’intégration dit ce qui s’est passé et l’heure de la prochaine
  lecture.
- Les valeurs semblent inversées (charge affichée comme décharge) ? Le signe
  de la puissance de la batterie n’a pas encore été vérifié sur une vraie
  batterie : merci de le signaler.
