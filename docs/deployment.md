# Déploiement

Le projet est déployé en deux morceaux, sur deux hébergeurs :

| Morceau | Hébergeur | Ce que c'est |
|---|---|---|
| Client React (`client/dist`) | **Vercel** — `loup.wapeto.net` | fichiers statiques + PWA |
| Serveur temps réel (`server/`) | **Render** — `onuw-server.onrender.com` | process Node long-lived, Socket.io + Redis |

## Pourquoi deux hébergeurs

Le serveur a d'abord été déployé sur Vercel en Vercel Function (WebSockets
beta). **Ça ne marche pas** : Socket.io échoue systématiquement à s'y attacher
(`FUNCTION_INVOCATION_FAILED` côté serveur, fermeture `1006` côté client),
alors que la bibliothèque `ws` brute fonctionne sur le même projet. Le
diagnostic a été isolé sur un endpoint dédié, sans Redis ni code applicatif,
et reproduit à l'identique avec les options par défaut, `addTrailingSlash:
false`, `perMessageDeflate: false` et `transports: ["websocket"]` côté serveur.
C'est une incompatibilité de plateforme, pas un bug de ce dépôt.

Le client, lui, marche parfaitement sur Vercel (build, rewrite SPA, manifest,
service worker, domaine) — il y reste donc.

## Serveur — Render

Tout est décrit dans `render.yaml` à la racine (Blueprint Render) : le service
web gratuit et l'instance Key Value (Redis) gratuite qui l'accompagne.

### Mise en place (une seule fois)

1. Créer un compte sur https://render.com (connexion via GitHub, **pas de carte
   bancaire demandée** pour le plan free).
2. **New → Blueprint**, choisir le dépôt `Wapeto/onuw`, brancher `master`.
   Render lit `render.yaml` et propose de créer `onuw-server` et `onuw-redis`.
3. Render demande la valeur de `CORS_ORIGIN` (seule variable non automatique) :
   mettre `https://loup.wapeto.net`. `REDIS_URL` est câblée automatiquement sur
   l'instance Key Value, il n'y a rien à saisir.
4. **Apply** : Render construit `shared` puis `server` et démarre
   `node server/dist/start.js`. Noter l'URL publique attribuée
   (`https://onuw-server.onrender.com` ou similaire).

### Vérification

`https://<url-render>/healthz` doit répondre `ok` en HTTP 200. C'est aussi le
`healthCheckPath` utilisé par Render : tant qu'il ne répond pas, le déploiement
est considéré comme échoué.

## Client — Vercel

Le projet Vercel `onuw-client` reste tel quel, à trois variables d'environnement
près :

- `VITE_SERVER_URL` = l'URL Render du serveur (`https://onuw-server.onrender.com`).
  Elle était volontairement vide du temps du même-origine ; elle est maintenant
  **obligatoire**, sinon le client tente de se connecter à `loup.wapeto.net`,
  où plus rien n'écoute.
- `VITE_SOCKET_PATH` — **à supprimer**. Elle valait `/api/socket-io/socket.io`,
  une convention propre aux Vercel Functions. Le serveur Render sert Socket.io
  sur son chemin par défaut (`/socket.io`), que le client utilise dès que la
  variable est absente.
- `REDIS_URL` — **à supprimer** aussi côté Vercel : le client statique n'y
  touche pas, seul le serveur (sur Render) parle à Redis.

Ces variables étant lues à la construction (`VITE_*`), il faut **redéployer**
le projet Vercel après les avoir changées — les modifier ne suffit pas.

## Limites du plan gratuit Render

- **Mise en veille** : le service s'endort après 15 minutes sans trafic HTTP ni
  message WebSocket, et met ~1 minute à se réveiller. Concrètement, la première
  personne à ouvrir le site après une période creuse attend le réveil ; les
  suivantes non. Une partie en cours n'endort pas le serveur, les messages
  WebSocket échangés réinitialisant le compteur d'inactivité.
- **750 heures d'instance par mois** par workspace, ce qui couvre un service
  unique tournant en continu.
- **Pas de persistance sur le Key Value gratuit** : les données sont perdues au
  redémarrage. L'état des parties est éphémère et déjà porté par des clés à TTL,
  donc seule une partie en cours au moment d'un redéploiement serait perdue.
- **Une seule instance**, pas de scaling. `@socket.io/redis-adapter` reste en
  place et fonctionne — il redeviendra utile le jour où il y aura plusieurs
  instances, sans changement de code.

## Ce qui est automatisé par ce dépôt

- `render.yaml` décrit l'intégralité de l'infrastructure serveur (service web,
  Redis, variables, health check). Chaque push sur `master` redéploie.
- `vercel.json` fixe `buildCommand`/`installCommand`/`outputDirectory` et la
  réécriture SPA pour que les routes React Router (`/room/:code`, `/join/:code`,
  le lien QR de join) survivent à un rechargement ou un lien direct. Chaque push
  sur `master` redéploie aussi.
- `server/src/start.ts` est le point d'entrée de production : il démarre sans
  condition (pas de garde `process.argv[1]`, fragile derrière un lien
  symbolique) et ferme proprement Socket.io et Redis sur `SIGTERM`, le signal
  que Render envoie avant un redéploiement ou une mise en veille.
