# Déploiement Vercel

Ce projet se déploie comme un seul projet Vercel : le client (`client/dist`,
statique) + `api/socket-io.ts` (Vercel Function Socket.io, WebSockets beta).

## Étapes manuelles (une seule fois, côté dashboard Vercel)

1. **Activer les WebSockets** sur le projet Vercel — fonctionnalité en beta
   publique nécessitant une permission dédiée. Voir
   `npx plugins add vercel/vercel-plugin` et
   https://vercel.com/docs/functions/websockets.
2. **Provisionner Redis (Upstash)** via le Marketplace Vercel, sur ce projet.
3. Dans les Environment Variables du projet Vercel, définir :
   - `REDIS_URL` — la chaîne de connexion `rediss://...` fournie par Upstash.
   - `VITE_SOCKET_PATH` = `/api/socket-io/socket.io`
   - `VITE_SERVER_URL` — **laisser non défini** (le client résout alors
     vers same-origin en production, voir `client/src/socketConfig.ts`).

## Ce qui est déjà automatisé par ce repo

- `vercel.json` définit `buildCommand`/`installCommand`/`outputDirectory`
  pour que Vercel construise `shared` → `server` → `client` dans l'ordre
  puis serve `client/dist`.
- `api/socket-io.ts` réutilise `createApp()` de `@onuw/server` sans
  dupliquer le wiring Socket.io/Redis — c'est le même code que celui testé
  en local et en CI via `server/src/index.test.ts`.
- Chaque push sur `master` redéploie automatiquement une fois le projet
  Vercel connecté au dépôt (comportement par défaut Vercel, aucune config
  supplémentaire requise).
