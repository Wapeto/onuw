# Déploiement Vercel

Ce projet se déploie comme un seul projet Vercel : le client (`client/dist`,
statique) + `api/socket-io.ts` (Vercel Function Socket.io, WebSockets beta).

## Étapes manuelles (une seule fois, côté dashboard Vercel)

1. **Activer les WebSockets** sur le projet Vercel — fonctionnalité en beta
   publique nécessitant une permission dédiée. La documentation officielle
   (https://vercel.com/docs/functions/websockets) référence
   `npx plugins add vercel/vercel-plugin` comme mécanisme d'activation ;
   confirmer la marche à suivre actuelle directement dans le dashboard
   Vercel ou la doc live au moment du déploiement, les flux d'activation de
   fonctionnalités beta pouvant évoluer.
2. **Provisionner Redis (Upstash)** via le Marketplace Vercel, sur ce projet.
3. Dans les Environment Variables du projet Vercel, définir :
   - `REDIS_URL` — la chaîne de connexion `rediss://...` fournie par Upstash.
   - `VITE_SOCKET_PATH` = `/api/socket-io/socket.io`
   - `VITE_SERVER_URL` — **laisser non défini** (le client résout alors
     vers same-origin en production, voir `client/src/socketConfig.ts`).

## Vérification au premier déploiement réel

La paire client/serveur pour le path Socket.io (`VITE_SOCKET_PATH` côté
client réglé sur `/api/socket-io/socket.io`, aucun `path` configuré côté
serveur dans `server/src/index.ts`) reproduit exactement l'exemple officiel
Vercel pour Socket.IO — non vérifiable localement, seulement contre un vrai
déploiement. Au premier déploiement, vérifier explicitement que le
handshake WebSocket aboutit (onglet réseau du navigateur : une connexion
`101 Switching Protocols` sur `/api/socket-io/socket.io/...`). Si ce
handshake échoue précisément à cet endroit, c'est le seul cas où ajouter un
`path` explicite côté serveur (`new Server(httpServer, { path: "..." })`)
devient nécessaire.

## Ce qui est déjà automatisé par ce repo

- `vercel.json` définit `buildCommand`/`installCommand`/`outputDirectory`
  pour que Vercel construise `shared` → `server` → `client` dans l'ordre
  puis serve `client/dist`, une réécriture SPA (`rewrites`) pour que les
  routes React Router (`/room/:code`, `/join/:code`, …) et le lien QR de
  join fonctionnent après un rechargement ou un lien direct, et
  `functions.maxDuration: 300` pour aligner la durée max de Function sur
  les ~5 minutes que cette architecture suppose déjà.
- `api/socket-io.ts` réutilise `createApp()` de `@onuw/server` sans
  dupliquer le wiring Socket.io/Redis — c'est le même code que celui testé
  en local et en CI via `server/src/index.test.ts`.
- Chaque push sur `master` redéploie automatiquement une fois le projet
  Vercel connecté au dépôt (comportement par défaut Vercel, aucune config
  supplémentaire requise).
