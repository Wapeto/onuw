# ONUW Web App — Plan de phases (pré-implémentation)

> **Statut : en attente de validation.** Ce document découpe la spec en phases livrables, verrouille les choix techniques ambigus, et documente les décisions prises suite aux questions posées. Pas une ligne de code n'a été écrite. Une fois validé, chaque phase sera détaillée en plan bite-sized TDD (via `superpowers:writing-plans` + `superpowers:subagent-driven-development` ou `executing-plans`) avant exécution.

**Source :** `onuw-web-spec.md` (racine du projet)

**Goal :** Web app multi-device pour jouer à One Night Ultimate Werewolf, avec anti-tell garanti par ticks de nuit uniformes et un onboarding sub-1-minute.

**Architecture :** Backend Node.js + Socket.io authoritaire (state machine par room), déployé comme Vercel Functions (voir §Hébergement — état partagé dans Redis, pas en mémoire locale, à cause du modèle serverless). Frontend React + TS en PWA installable, même projet Vercel. Un seul moteur de tick générique pilote la nuit — aucune branche de code spécifique par rôle dans le runner, seulement des tables de config et des resolvers purs.

**Tech Stack :** Node.js, TypeScript strict, Socket.io + `@socket.io/redis-adapter`, Redis (Upstash via Vercel Marketplace), React 18, Vite, `qrcode` (client), Vitest.

---

## Décisions prises suite aux questions posées

| Point | Décision | Détail |
|---|---|---|
| Presets Classique 3-10 joueurs | Rulebook officiel Bezier, avec extrapolation documentée pour 6-10 (voir §Presets ci-dessous — **le rulebook officiel ne couvre explicitement que 3, 4, 5 joueurs**) | §3 |
| Mode Simple | Jamais de Loup Solitaire — la compo Simple garantit toujours ≥2 Loups quand le nombre de joueurs le permet | Phase 3 |
| Reconnexion nuit | Pause + grace period (freeze du timer pour tout le monde, ~40s configurable) | Phase 1 & 4 |
| Scope rôles v1 | 11 rôles de base + 1 rôle Daybreak/Bonus (Village Idiot) pour stress-tester l'extensibilité | Phase 3 |
| Hébergement | Tout sur Vercel (client + serveur), malgré la complexité que ça ajoute — voir §Hébergement | Phase 1 & 7 |

### Hébergement — pourquoi ce n'est pas juste "déployer sur Vercel"

Vercel a lancé un vrai support WebSocket natif (beta publique, 22 juin 2026), compatible Socket.io. Mais deux contraintes structurelles de leur modèle serverless changent l'archi de la Phase 1, posée initialement avec un `Map` en mémoire :

1. **Pas de garantie que deux connexions atterrissent sur la même instance de Function.** Deux joueurs de la même room peuvent être servis par deux instances différentes qui ne partagent aucune mémoire locale. Vercel recommande lui-même Redis pour tout état partagé — donc `GameState` vit dans Redis (Upstash, gratuit via leur Marketplace), pas dans un `Map` local, et Socket.io doit utiliser `@socket.io/redis-adapter` pour que les broadcasts atteignent des sockets connectés à des instances différentes.
2. **Plan Hobby (gratuit) : 300s (5 min) de durée max par invocation de Function, fixe, non configurable.** Une connexion WebSocket = une invocation de Function → **chaque connexion joueur est coupée de force toutes les 5 min**, sans exception. Le Lobby (attente variable) et le Day (3-5 min configurable) dépassent facilement ce seuil en usage normal — ce n'est pas un cas de perte de wifi rare, c'est le fonctionnement standard attendu sur ce plan.

Conséquence directe sur la Phase 1 : la reconnexion ne peut plus être traitée comme l'exception "pause + grace period" décidée plus haut pour la nuit — pauser toute la table à chaque coupure de 5 min serait une interruption constante et visible. Le design retenu :
- **Autorité du timer de tick dans Redis** (timestamp de début + index de tick), jamais dans un `setTimeout` local à une instance de Function — n'importe quelle instance qui reprend une connexion doit pouvoir recalculer où en est le tick en cours.
- **Reconnexion silencieuse et rapide comme comportement de base** pour Lobby/Day/Vote (pas une branche d'erreur) : le client redétecte la coupure, rouvre une connexion, le serveur rehydrate depuis Redis via le `playerId` en `sessionStorage`, sans interruption visible pour les autres joueurs.
- La règle "pause + grace period" reste pertinente spécifiquement **pendant un tick de nuit** (les ticks durent 5-8s, très en dessous de la limite de 5 min — un vrai drop réseau pendant un tick reste un cas rare qui justifie une vraie pause, contrairement au cycle de connexion normal de Vercel).
- Le client Socket.io doit forcer `transports: ['websocket']` (pas de fallback long-polling, Vercel ne route que les upgrades) et un `path` cohérent avec la convention Vercel (`/api/socket-io/socket.io`).
- Côté fichiers : le serveur n'est plus un process Node long-lived classique — c'est une Vercel Function (`api/socket-io.ts` exportant l'objet `http.Server` sans appeler `.listen()`). Le code de wiring Socket.io écrit en Phase 0/1 (`createApp()`) reste utilisable tel quel pour le dev local et les tests (vitest fait tourner `listen()` sur un port éphémère) ; un fichier d'adaptation Vercel séparé réutilise la même logique sans la dupliquer.

### Presets Classique — ce que le rulebook dit vraiment

J'ai été chercher le rulebook officiel Bezier Games (One Night Ultimate Werewolf, ©2014 Ted Alspach) avant de figer les chiffres. Verdict : la table officielle **ne couvre que 3, 4 et 5 joueurs** :

- **3 joueurs (6 cartes)** : 2 Loups, 1 Voyante (Seer), 1 Voleur (Robber), 1 Semeuse de troubles (Troublemaker), 1 Villageois
- **4 joueurs (7 cartes)** : idem + 1 Villageois
- **5 joueurs (8 cartes)** : idem (base 3j) + 2 Villageois

Pour 6-10 joueurs, le rulebook dit littéralement : *"Setup differs based on the number of players (3-10)... You may use additional roles beyond the basic setup... you probably don't want to introduce more than 1-2 new roles at a time."* — autrement dit, **il n'existe aucune compo officielle figée au-delà de 5 joueurs**, juste une philosophie ("ajoute 1-2 rôles à la fois en montant"). Comme tu as choisi "suivre l'officiel", voici la proposition qui applique cette philosophie en partant de la base 5j officielle :

| Joueurs | Cartes | Compo proposée (delta vs. précédent) |
|---|---|---|
| 3 | 6 | 2 Loups, Seer, Robber, Troublemaker, Villager |
| 4 | 7 | + Villager |
| 5 | 8 | + Villager (= officiel : 3 Villagers) |
| 6 | 9 | + Insomniac (cohérent avec Robber/Troublemaker déjà en jeu — le rulebook dit explicitement "only use Insomniac if Robber and/or Troublemaker in game") |
| 7 | 10 | + Tanner |
| 8 | 11 | + Minion |
| 9 | 12 | + Hunter |
| 10 | 13 | + Mason, Mason (paire obligatoire — remplace 2 Villagers) |

**Ce tableau 6-10 n'est PAS sourcé du rulebook, c'est mon extrapolation** suivant sa propre logique additive. À valider ou à corriger toi-même — c'est un endroit où ton jugement de joueur vaut plus que le mien. Le Doppelganger n'apparaît dans aucun preset Classique (trop complexe pour "zéro décision") ; il reste réservé au mode Personnalisé.

### Reconnexion — sous-cas non couvert par ta réponse

Tu as choisi "pause + grace period". Reste un sous-cas : **que se passe-t-il si le grace period (40s) expire sans reconnexion ?** Deux options possibles pour la Phase 1/4, je pars sur la première par défaut sauf contre-ordre :
- **Défaut proposé** : la partie continue sans le joueur (son action du tick en cours devient un no-op / dummy), il pourra rejoindre à la reconnexion suivante (Day/Vote inclus) via son `playerId` en sessionStorage.
- **Alternative** : abandon de partie, retour au lobby pour tout le monde.

---

## Contraintes globales (extraites de la spec, valables pour toutes les phases)

- Chaque tick de nuit dure une durée fixe + jitter aléatoire 0-1.5s, **identique que ce soit une vraie action ou un dummy**, et le timing envoyé aux clients est calculé une seule fois côté serveur (jamais recalculé indépendamment par client, sinon désync visuelle).
- **Tous les ticks tournent toujours**, y compris pour des rôles absents de la partie — l'absence de tick ne doit jamais trahir la composition.
- Le dummy screen exige une vraie interaction (bouton/swipe), jamais un écran statique.
- Fullscreen API forcé + navigation retour désactivée pendant la nuit.
- Join en <1 min : code court (4-5 caractères) + QR, pseudo seul, pas de compte, identité via `playerId` en `sessionStorage`.
- Mode Classique = zéro décision pour le host au-delà du nombre de joueurs.
- **État de partie dans Redis (Upstash), pas en mémoire locale** — imposé par l'hébergement Vercel (voir §Hébergement), avec TTL de nettoyage après inactivité côté Redis. Ce n'est plus une option "v1 simple", c'est une contrainte d'hébergement.
- Le serveur est authoritaire sur toute la logique de rôles ; le client n'est jamais digne de confiance pour ça.
- Reconnexion silencieuse (Lobby/Day/Vote) traitée comme comportement normal, pas comme une erreur — voir §Hébergement pour le détail.

---

## Choix techniques à trancher

1. **Structure du repo** : monorepo npm workspaces (`/shared`, `/server`, `/client`), pas de Turborepo/Nx — le projet est trop petit pour en justifier l'overhead. `/shared` contient les types partagés (rôles, `GameState`, contrats d'events Socket.io) pour que client et serveur ne divergent jamais silencieusement.
2. **Vite + React SPA, pas Next.js** — pas de besoin de SSR/routing serveur pour une PWA temps réel pilotée par websocket ; Next.js ajouterait de la complexité (API routes inutiles ici, le vrai backend est le serveur Socket.io) sans bénéfice. À confirmer si tu as une préférence contraire.
3. **State machine faite main, pas XState** — la spec elle-même sketch déjà la forme exacte voulue (`NightTick[]` config-driven). XState ajoute une courbe d'apprentissage et une dépendance sans gain net à cette échelle ; un reducer + une table de config suffisent et restent lisibles.
4. **Gestion jitter/dummy sans duplication par rôle** — verrouillé après lecture du rulebook officiel :
   - Un seul `TickRunner` générique boucle sur `NIGHT_ORDER` (10 entrées désormais, voir point 5) sans jamais connaître la logique métier d'un rôle.
   - Pour chaque tick, le serveur calcule `durationMs` une fois (fixe + jitter), le broadcast à tous, puis évalue `activeFor(player, gameState)` par joueur pour décider en privé (émission par socket, jamais broadcast) s'il reçoit le payload d'action réelle ou le payload dummy.
   - `DummyScreen` est **un seul composant générique** côté client, paramétré par config (libellé du bouton, variante d'interaction) — jamais un composant par rôle.
   - Les actions de rôle (`Seer`, `Robber`, `Troublemaker`, `Drunk`...) sont des **fonctions pures** `(actingPlayerId, gameState, params) => newGameState`, rangées dans une table `actionResolvers: Record<RoleId, Resolver>`. Le tick normal appelle `actionResolvers[tick.roleId]`. Ça permet la réutilisation exacte pour le cas Doppelganger ci-dessous, sans dupliquer la logique.
5. **Cas Doppelganger, résolu précisément (pas juste "à prévoir" comme dans la spec)** — le rulebook officiel distingue 3 comportements selon le rôle copié, pas un seul :
   - Copie Villager/Tanner/Hunter → rien d'autre cette nuit.
   - Copie Werewolf/Mason → le Doppelganger devient actif **dans le tick Werewolf/Mason lui-même** (`activeFor` inclut le Doppelganger pour ce tick) — pas d'injection, juste un joueur actif de plus dans un tick déjà générique.
   - Copie Seer/Robber/Troublemaker/Drunk → le Doppelganger exécute cette action **immédiatement dans son propre tick (tick 1)**, en appelant directement `actionResolvers[copiedRoleId]` — c'est le seul endroit où le tick Doppelganger n'est pas 100% générique (il doit savoir enchaîner sur un resolver externe après le reveal), documenté explicitement comme exception assumée plutôt que caché dans une couche d'abstraction qui prétendrait être générique partout.
   - Copie Insomniac → le rulebook a en fait un wake-step officiel dédié : **"#9a: Doppelgänger/Insomniac"**. Je le modélise comme un **10e tick à part entière dans `NIGHT_ORDER`**, qui tourne toujours pour tout le monde comme les 9 autres (dummy pour tout le monde sauf le cas concerné) — ça élimine le besoin d'un "sous-état spécial" que la spec anticipait comme un problème ouvert ; le mécanisme uniforme le couvre nativement.
6. **Reconnexion** : `playerId` (uuid) généré au join, stocké en `sessionStorage`, envoyé dans le handshake Socket.io (`auth: { roomCode, playerId }`). Le serveur mappe `playerId → socket.id` courant dans Redis (pas en mémoire locale — une reconnexion peut atterrir sur une toute autre instance de Function), donc un changement de `socket.id` est correctement réattaché quelle que soit l'instance. En Lobby/Day/Vote, c'est une reconnexion silencieuse (comportement normal, déclenché toutes les ~5 min par la limite Vercel Hobby — voir §Hébergement). Sur disconnect pendant un tick de `NIGHT` spécifiquement (ticks courts, un vrai drop y reste rare), le serveur freeze le tick courant (stocke `remainingMs` dans Redis), broadcast un `TICK_PAUSED` neutre (ne révèle jamais qui a décroché) et attend le grace period avant `TICK_RESUMED` ou passage en no-op (voir sous-cas ci-dessus).
7. **Hébergement Vercel** : voir §Hébergement pour le détail complet. En bref — un seul projet Vercel (client statique + `api/socket-io.ts` en Vercel Function), Redis (Upstash, gratuit) comme unique source de vérité pour `GameState` et l'autorité de timing des ticks, `@socket.io/redis-adapter` pour le broadcast cross-instance, client forcé en `transports: ['websocket']`.

---

## Phases

### Phase 0 — Setup projet
**Livrable :** monorepo scaffoldé et buildable (`npm run dev` lance client + serveur), types partagés en place, aucun jeu encore.

**Fichiers/modules :**
- `/package.json` (workspaces: `shared`, `server`, `client`)
- `/shared/src/types.ts` — `RoleId`, `Player`, `GameState`, `RoomPhase`, contrats d'events Socket.io (`ClientToServerEvents`, `ServerToClientEvents`)
- `/server/package.json`, `/server/src/index.ts` (boot Socket.io nu)
- `/client/` (scaffold Vite + React + TS)
- `.eslintrc`, `tsconfig.base.json`, config Vitest

**Dépendances :** aucune — c'est la racine de tout le reste.

---

### Phase 1 — State machine serveur & moteur de tick
**Livrable :** room store authoritaire **dans Redis** (pas en mémoire — voir §Hébergement), transitions de phase (`LOBBY → ROLE_SELECT → NIGHT → DAY → VOTE → REVEAL → LOBBY`), `TickRunner` générique complet dont l'autorité de timing (tick courant + horodatage de début) vit dans Redis plutôt que dans un `setTimeout` local, `@socket.io/redis-adapter` branché pour le broadcast cross-instance, `NIGHT_ORDER` avec les 10 ticks (9 officiels + le 9a Doppelganger/Insomniac), `actionResolvers` pour les rôles nocturnes, reconnexion silencieuse (Lobby/Day/Vote) + pause/grace-period (spécifique aux ticks de nuit). Testable en isolation (pas besoin d'UI, tests directs sur la state machine + un client Redis de test).

**Fichiers/modules :**
- `server/src/rooms/roomStore.ts` — accès `RoomState` dans Redis (get/set/TTL), plus l'interface que le reste du code consomme (le détail Redis reste encapsulé ici)
- `server/src/state/phases.ts` — enum + guards de transition
- `server/src/night/nightOrder.ts` — la config `NIGHT_ORDER: NightTick[]` (10 entrées)
- `server/src/night/tickRunner.ts` — le runner générique ; lit/écrit l'état du tick courant (index, horodatage, durée+jitter) dans Redis via `roomStore.ts`, jamais dans une variable locale au process
- `server/src/roles/actionResolvers.ts` — fonctions pures par `RoleId`, réutilisées par tick normal ET par l'injection Doppelganger
- `server/src/rooms/disconnectHandler.ts` — reconnexion silencieuse (Lobby/Day/Vote) via `playerId` en `sessionStorage` + rehydratation Redis ; pause/grace-period réservée aux ticks de nuit
- `server/src/redis/client.ts` — client Redis (Upstash) partagé, et wiring de `@socket.io/redis-adapter`

**Dépendances :** Phase 0 (types partagés).

---

### Phase 2 — Lobby / join flow
**Livrable :** créer une room (host, code court + QR), rejoindre par code, liste des joueurs en live, pseudo only, bouton "Lancer" gaté sur un preset valide.

**Fichiers/modules :**
- `client/src/pages/Home.tsx` — écran création/join
- `client/src/pages/Lobby.tsx` — liste live des joueurs
- `client/src/hooks/useRoomSocket.ts` — wrapper Socket.io côté client
- `server/src/rooms/roomEvents.ts` — `CREATE_ROOM`, `JOIN_ROOM`, `PLAYER_LIST_UPDATE`
- lib `qrcode` (client-side, pas de backend dédié)

**Dépendances :** Phase 0, Phase 1 (room store).

**Prérequis identifiés par la revue finale de Phase 1 (à traiter EN DÉBUT de Phase 2, pas après) :**
- **Race Redis générale sur le join concurrent.** `roomStore.ts` fait un `getRoom → mutate → saveRoom` non-atomique. Le join flow va faire exactement ça à N joueurs qui scannent le QR simultanément (`getRoom → players.push → saveRoom`) — sans protection, des joins concurrents se perdent silencieusement (pas un cas rare, c'est le mode de démarrage normal du jeu). Corrigé pour `createRoom` seul (flag `NX`, commit `a0f1da5`), mais le pattern général read-modify-write reste non protégé. Ajouter un wrapper `withRoom(roomCode, fn)` basé sur `WATCH`/`MULTI` (ou un CAS via champ de version) dans `roomStore.ts` avant d'écrire `JOIN_ROOM`.
- **`PLAYER_LIST_UPDATE` ne doit jamais exposer `connected` en broadcast pendant `NIGHT`.** `Player.connected` existe déjà (Task 11). Si ce champ est broadcasté tel quel pendant la nuit, ça révèle qui a décroché — ce que `TICK_PAUSED` prend justement soin de ne jamais faire (payload neutre `{}`). Filtrer/masquer `connected` dans tout event de roster diffusé pendant `NIGHT`.
- Envisager `socket.join(playerId)` (room Socket.io per-player) plutôt qu'une table `playerId → socketId` maison — ça compose nativement avec l'adapter Redis déjà branché (Phase 1) et survit à une reconnexion sur une autre instance.

---

---

### Phase 3 — Configuration des rôles
**Livrable :** mode Classique (presets 3-10, voir tableau ci-dessus), mode Simple (jamais de Loup Solitaire), mode Personnalisé (validation live `total = N+3`, rôles grisés selon compat N), écran récapitulatif visible par tous avant lancement, le rôle Bonus (Village Idiot) disponible en Personnalisé uniquement.

**Fichiers/modules :**
- `shared/src/rolePresets.ts` — les tables Classique/Simple + règles de compat par N
- `client/src/pages/RoleSelect.tsx`
- `client/src/components/RoleRecap.tsx`
- `server/src/roles/presetValidation.ts`

**Dépendances :** Phase 2 (lobby), Phase 1 (les rôles choisis pilotent `NIGHT_ORDER`/`actionResolvers`).

---

### Phase 4 — Séquence de nuit
**Livrable :** la nuit de bout en bout avec vraie UI — `DummyScreen` générique réutilisé pour tout rôle/tick non concerné, écrans d'action réels par rôle (Seer, Robber, Troublemaker, Drunk, Werewolf incl. Loup Solitaire, Minion avec asymétrie d'info, Mason, Insomniac, Doppelganger incl. son action composée + le tick 9a), fullscreen forcé + navigation retour bloquée, pause/reprise sur déconnexion.

**Fichiers/modules :**
- `client/src/pages/Night.tsx` — orchestrateur, écoute `TICK_START`/`TICK_PAUSED`/`TICK_RESUMED`
- `client/src/components/night/DummyScreen.tsx` — seul composant dummy, config-driven
- `client/src/components/night/roles/*.tsx` — un petit fichier par écran d'action réel
- `client/src/hooks/useFullscreen.ts`
- `server/src/night/disconnectHandler.ts` (déjà posé Phase 1, branché ici à l'UI)

**Dépendances :** Phase 1 (tick runner), Phase 3 (rôles en jeu).

**Note :** c'est la phase la plus critique et la plus dense (le cœur de la garantie anti-tell). À détailler en plan bite-sized séparé avant exécution.

**Prérequis identifiés par la revue finale de Phase 1 (bloquants pour cette phase spécifiquement) :**
- **`shared/src/types.ts` ne déclare que l'event `connected` dans `ServerToClientEvents`.** Le serveur (Phase 1) émet déjà `TICK_START` / `TICK_PAYLOAD` / `TICK_PAUSED` / `TICK_RESUMED` / `NIGHT_END` mais uniquement comme littéraux `string` côté `tickRunner.ts` — aucun contrat partagé. Étendre `ServerToClientEvents`/`ClientToServerEvents` avec ces 5 events et leurs payloads exacts AVANT d'écrire `Night.tsx`, sinon le client recrée les formes de payload à la main sans lien de compilation avec le serveur (ce que `/shared` existe justement pour éviter).
- **Validation de payload à la frontière socket.** Les `actionResolvers` (Phase 1) acceptent des params typés mais non validés à l'exécution (`robberResolver({targetPlayerId})`, etc. — un `subParams` mal formé ne lève pas toujours une erreur propre, cf. `getCenterCard`/`requireCurrentRole` ajoutés en Phase 1 qui couvrent la moitié interne du problème). Le handler socket qui reçoit l'action d'un joueur et construit ces params doit valider le payload brut (Zod ou équivalent) avant d'appeler un resolver — c'est la frontière non-fiable qui n'existait pas encore en Phase 1.
- **`pendingGrace` dans `disconnectHandler.ts` est un `Set` process-local.** Fonctionne en dev (process Node unique) mais un joueur qui décroche sur l'instance A et se reconnecte sur l'instance B (cas normal une fois sur Vercel, Phase 7) ne déclenchera jamais `resumeTick` — la partie reste en pause indéfiniment pour ce cas. Si Phase 4 est testée uniquement en local ce n'est pas bloquant tout de suite, mais noter que ça devra migrer vers un état stocké dans `NightState` (ex. `graceUntil`) avant tout déploiement multi-instance.

**Prérequis identifiés par la revue finale de Phase 3 (bloquants ou pertinents pour cette phase) :**
- **Le prérequis Phase 1 ci-dessus (typer `TICK_START`/`TICK_PAYLOAD`/`TICK_PAUSED`/`TICK_RESUMED`/`NIGHT_END`) est toujours ouvert et confirmé bloquant.** La revue finale de Phase 3 a vérifié que `server/src/index.ts` continue de passer ces events comme `string` littéraux castés (un seul cast explicite, commenté, pas de nouvelle dépendance non-sûre introduite par Phase 3) — la dette n'a pas grossi, mais elle n'a pas non plus été remboursée. Toujours à faire AVANT `Night.tsx`.
- **Pas de garde-fou "au moins un Loup-Garou" dans `validateRoleSelection` (`shared/src/rolePresets.ts`).** Une sélection Personnalisée avec `werewolf: 0` passe la validation si le total et les règles singleton/mason/insomniac sont respectées — une partie sans Loup est dégénérée mais lançable. Pas un défaut de Phase 3 (pas une contrainte listée), mais Phase 4 (et son moteur de nuit) devrait décider explicitement si ce cas doit être bloqué en amont (Phase 3) ou toléré comme partie dégénérée valide.
- **Duplication mineure à nettoyer si ce fichier est retouché :** `server/src/rooms/roomEvents.ts` (autour de la reconnexion, catch-up) reconstruit à la main le même payload `{ mode, roles, valid }` que `broadcastRoleSelection` encapsule déjà — un helper partagé type `roleSelectionPayload(state)` évite la divergence si l'un des deux est modifié sans l'autre. Non bloquant, à faire à l'occasion.

---

### Phase 5 — Phase jour & vote
**Livrable :** timer jour visible (configurable host, 3-5 min), UI de vote (gros boutons pseudo/avatar), révélation simultanée du résultat pour tout le monde.

**Fichiers/modules :**
- `client/src/pages/Day.tsx`
- `client/src/pages/Vote.tsx`
- `server/src/state/voteResolver.ts`

**Dépendances :** Phase 4 (les assignations de rôles finales doivent être résolues avant le vote).

---

### Phase 6 — Reveal & Rejouer
**Livrable :** calcul des conditions de victoire (Village/Loups/Tanner/Hunter, cas Minion sans Loup, kill en chaîne du Hunter), écran de reveal (rôle final de chacun après échanges), bouton "Rejouer" qui garde le lobby et les joueurs, permet de garder/changer la config de rôles.

**Fichiers/modules :**
- `server/src/state/winConditions.ts`
- `client/src/pages/Reveal.tsx`

**Dépendances :** Phase 5.

---

### Phase 7 — Polish PWA & déploiement Vercel
**Livrable :** manifest installable, service worker (coquille offline seulement — le gameplay reste online-only, pas de cache temps réel), écran d'onboarding "tête baissée" avec toggle "ne plus afficher" persistant par session/groupe, dernier passage fullscreen/orientation, **+ mise en place du déploiement Vercel** : `api/socket-io.ts` (adapte le `createApp()` de la Phase 0/1 au format Vercel Function, sans dupliquer le wiring), provisioning Redis (Upstash) via le Marketplace Vercel, `vercel.json` si nécessaire, activation du flag beta WebSockets sur le projet, déploiement auto à chaque push sur `master`.

**Fichiers/modules :**
- `client/public/manifest.json`
- `client/src/sw.ts`
- `client/src/components/OnboardingNotice.tsx`
- `api/socket-io.ts` — entrée Vercel Function, réutilise `createApp()` de `server/`
- `vercel.json` (si besoin de config de routing/région)

**Dépendances :** toutes les phases précédentes (couche finale).

---

## Prochaine étape

Ce plan attend ta validation. Une fois validé (avec corrections sur le tableau de presets 6-10 et le sous-cas grace-period si besoin), la prochaine étape est de détailler chaque phase en plan bite-sized TDD via `superpowers:writing-plans`, en commençant par la Phase 0 et la Phase 1 (le socle), avant toute exécution de code.
