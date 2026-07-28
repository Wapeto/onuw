# ONUW Web — Spec technique

## 1. Contexte du jeu (référence rapide)

One Night Ultimate Werewolf (Bezier Games, Ted Alspach & Akihisa Okui). 3-10 joueurs, toujours N+3 cartes (N joueurs + 3 au centre). Une seule phase de nuit, une phase de jour, un vote simultané, fin de partie. Pas d'élimination avant le vote final.

### Ordre de réveil officiel (wake order)
1. **Doppelganger** — regarde la carte d'un joueur, devient ce rôle, agit immédiatement à sa place dans l'ordre (sauf Villageois/Tanner/Chasseur qui ne font rien)
2. **Werewolf** (x2 typiquement) — se voient entre eux ; si seul, peut regarder une carte du centre (Loup Solitaire)
3. **Minion** — voit qui sont les Loups (sans être vu d'eux)
4. **Mason** (x2) — se voient entre eux
5. **Seer** — regarde la carte d'un joueur, ou 2 cartes du centre
6. **Robber** — échange sa carte avec celle d'un joueur, regarde sa nouvelle carte
7. **Troublemaker** — échange les cartes de deux autres joueurs (sans les regarder)
8. **Drunk** — échange sa carte avec une carte du centre sans la regarder
9. **Insomniac** — regarde sa propre carte (utile si Robber/Troublemaker l'a touchée)

Rôles passifs (aucune action nocturne) : Villager, Hunter, Tanner.

### Extensions notables (pour plus tard, pas v1)
- **Daybreak** : Alpha Wolf, Curator, Village Idiot, Sentinel, Diseased, Revealer...
- **Vampire** : ajoute une 3e faction (Vampires vs Loups vs Village) — casse la binarité, complexité +
- **Bonus roles** : Apprentice Tanner, Beholder, Aura Seer, Cursed, Prince...

## 2. Le problème central que tu as identifié

Le jeu physique repose sur deux garanties simultanées que le digital casse par défaut :
- **Anonymat visuel** (yeux fermés → sur appli, tête baissée / écran perso)
- **Anonymat comportemental** (personne ne sait qui interagit avec quoi, parce que TOUT LE MONDE a les yeux fermés en même temps)

Le deuxième point est le vrai piège. Aucune des apps existantes que j'ai trouvées (Skyost's Mobile Werewolf, Wolvesville Classic, Play Werewolf, Mafia Role Assigner, l'app officielle Bezier) ne le résout — elles font toutes du "un seul device qui tourne + narration audio" ou du "chacun voit son rôle une fois puis discussion", pas du multi-device synchronisé avec anti-tell actif. C'est un vrai axe différenciant pour ton projet, pas un truc à réinventer depuis du prior art.

## 3. Mécanique anti-tell — "Uniform Night Ticks"

Principe : la nuit n'est pas une liste de rôles qui s'activent un par un, c'est une **séquence de ticks de durée fixe**, et à CHAQUE tick, TOUS les joueurs reçoivent un événement device (vibration + écran qui s'allume), que leur rôle soit concerné ou non.

```
Tick 1 (Doppelganger)   → tous vibrent, doppelganger a une vraie action, les autres ont un dummy screen
Tick 2 (Werewolf)       → tous vibrent, loups ont une vraie action, les autres dummy
Tick 3 (Minion)         → idem
Tick 4 (Mason)          → idem
Tick 5 (Seer)           → idem
Tick 6 (Robber)         → idem
Tick 7 (Troublemaker)   → idem
Tick 8 (Drunk)          → idem
Tick 9 (Insomniac)      → idem
```

Règles strictes pour que ça tienne :
- **Durée fixe par tick** (ex. 7s), identique que ce soit une vraie action ou un dummy, ± jitter aléatoire de 0-1.5s pour éviter le pattern "toujours exactement 7.000s"
- **Le dummy screen n'est pas un écran vide** : ça doit demander une interaction (ex. un bouton "Continuer à dormir" à presser, ou un mini-mécanisme comme swiper), sinon la différence "vrai choix avec plusieurs boutons" vs "écran statique" reste visible au regard périphérique
- **Tick systématiquement actif pour tout le monde**, même les rôles qui logiquement "n'existent pas dans cette partie" (si pas de Mason en jeu, le tick Mason a quand même lieu pour tout le monde, avec dummy pour tout le monde — sinon la présence/absence de tick trahit la composition de rôles)
- **Cas Doppelganger particulier** : si le Doppelganger copie un Loup, il doit agir DANS le tick Werewolf original, pas créer un tick bonus après — sinon ça allonge visiblement cette partie de la nuit. Ça veut dire que ton state machine doit permettre une "action injectée" dans un tick déjà en cours plutôt que d'ajouter un tick.
- **Cas Loups multiples vs Loup Solitaire** : que tu aies 0, 1 ou 2 Loups, le tick Werewolf dure pareil. S'il n'y a qu'un loup qui regarde le centre, ça prend le même temps qu'un échange visuel entre deux loups (le timer ne dépend jamais du nombre de vraies interactions à l'intérieur).

## 4. Anonymat visuel — remplacement du "yeux fermés"

- Objectif réel : personne ne voit l'écran ni la gestuelle d'un autre joueur, pas "il fait noir"
- Solution : **"tête baissée, chacun regarde son propre écran"**, annoncé une fois en début de partie (texte + éventuellement une image/icône dans l'appli), pas besoin de mécanique technique dessus
- Corollaire : l'écran de chaque joueur doit forcer un **fullscreen** (Fullscreen API) et désactiver le retour navigateur pendant la nuit, pour éviter qu'un joueur pose son tel avec l'écran visible ou switch d'appli

## 5. UX & onboarding — priorité absolue sur tout le reste

Le projet doit rester utilisable par un groupe qui n'a jamais touché à l'appli, en moins d'une minute entre "on veut jouer" et "tout le monde a un rôle". Ça prime sur le nombre de rôles ou la richesse des options.

### Flow de connexion
- Un joueur clique **"Créer une partie"** → devient host → reçoit un **code court (4-5 lettres/chiffres)** + un **QR code** généré à la volée (juste une lib type `qrcode` côté client, pas besoin de backend dédié)
- Les autres scannent le QR (ou tapent le code manuellement en fallback, tout le monde n'a pas de scanner QR ouvert) → rejoignent direct un écran "Lobby" avec la liste des joueurs présents en live (via Socket.io)
- Chaque joueur choisit juste un **pseudo** à l'entrée, pas de compte, pas d'email, pas de mot de passe — la session vit dans le `roomCode` + un `playerId` stocké en `sessionStorage` (pour survivre à un refresh accidentel)
- Le host a un bouton **"Lancer la partie"** qui n'apparaît que si le nombre de joueurs correspond à un preset valide

### Configuration des rôles — doit rester simple par défaut
- **Mode par défaut : "Classique"** — le host choisit juste le nombre de joueurs, l'appli propose automatiquement une compo standard éprouvée (ex. pour 5 joueurs : 2 Loups, Seer, Robber, Troublemaker, Villager + 3 cartes au centre), zéro décision à prendre
- **Mode "Simple / sans rôles spéciaux"** — juste des Villageois et des Loups, aucune action de nuit sauf le tick Loups (qui se voient entre eux). Bonus : ce mode sert aussi de "tutoriel" naturel pour un groupe qui découvre le concept avant d'ajouter des rôles la partie suivante.
- **Mode "Personnalisé"** — le host coche/décoche des rôles dans une liste, l'appli valide en live que le total = joueurs + 3 et grise les rôles incompatibles avec le nombre de joueurs actuel
- Dans tous les modes, un écran récapitulatif avant lancement montre les rôles en jeu (comme les jetons au centre de la table dans la version physique), visible par tous, pas juste le host

### Compréhension pendant la partie
- Avant la nuit : un écran bref rappelle "tête baissée, chacun regarde son écran" (une seule fois, pas à chaque partie si le groupe a déjà joué — un toggle "ne plus afficher" dans les settings du groupe/session)
- Pendant un tick : le texte à l'écran doit être auto-porteur, genre le joueur ne doit jamais avoir besoin d'ouvrir une règle externe pour comprendre son action ("Touche la carte d'un joueur pour voir son rôle", pas juste "Voyante")
- Jour : un timer visible simple (ex. 3-5 min ajustable par le host avant la partie), sans forcer l'appli à intervenir dans la discussion
- Vote : gros boutons avec les pseudos/avatars, un tap = un vote, résultat révélé en même temps pour tout le monde

### Rejouer vite
- Après la Reveal, un bouton **"Rejouer"** qui garde le même lobby et les mêmes joueurs, permet juste de changer/garder la config de rôles — objectif : enchaîner plusieurs parties de 10 min sans re-scanner de QR à chaque fois

## 6. Architecture technique proposée

### Stack (cohérente avec ton profil)
- **Backend** : Node.js + Socket.io, state machine authoritaire côté serveur (jamais confiance au client pour la logique de rôles)
- **Frontend** : React + TS, PWA (pas besoin d'appli native, juste un manifest.json + service worker pour l'aspect "installable" et fullscreen sur mobile)
- **Pas de DB persistante nécessaire pour la v1** : état de partie en mémoire (Map par room code), TTL de nettoyage après X minutes d'inactivité

### State machine (squelette)

```
LOBBY → ROLE_SELECT → NIGHT (séquence de ticks fixes) → DAY (discussion, timer only) → VOTE → REVEAL → LOBBY
```

Chaque tick de nuit est un objet de config, pas du code ad hoc par rôle :

```ts
type NightTick = {
  roleId: string;           // "werewolf", "seer", etc.
  durationMs: number;       // fixe + jitter appliqué au runtime
  activeFor: (player: Player, gameState: GameState) => boolean; // qui a une vraie action ce tick
  action: RoleAction;       // ce que fait le joueur actif
  dummyAction: DummyAction; // ce que voit/fait le joueur passif ce tick
};

const NIGHT_ORDER: NightTick[] = [
  { roleId: "doppelganger", durationMs: 8000, ... },
  { roleId: "werewolf",     durationMs: 7000, ... },
  { roleId: "minion",       durationMs: 5000, ... },
  { roleId: "mason",        durationMs: 5000, ... },
  { roleId: "seer",         durationMs: 8000, ... },
  { roleId: "robber",       durationMs: 8000, ... },
  { roleId: "troublemaker", durationMs: 7000, ... },
  { roleId: "drunk",        durationMs: 5000, ... },
  { roleId: "insomniac",    durationMs: 5000, ... },
];
```

Le serveur boucle sur `NIGHT_ORDER` inconditionnellement (que le rôle soit en jeu ou non dans cette partie précise — sinon l'absence de tick trahit la compo), broadcast `TICK_START` à tous les sockets en même temps avec `{ tickIndex, durationMs }`, et chaque client décide localement d'afficher son vrai écran ou le dummy selon son rôle actuel (le serveur lui envoie son payload spécifique en privé, jamais broadcast).

### Points d'attention identifiés dans l'échange précédent, à ne pas perdre à l'implémentation
- Le Doppelganger qui devient Robber/Troublemaker/Drunk agit **immédiatement dans son propre tick**, pas dans le tick du rôle copié (règle officielle, à respecter dans le state machine)
- Le Doppelganger qui devient Insomniac regarde sa carte juste après le tick Insomniac normal, prévoir un sous-état ou un tick "phantom" identique en durée aux autres
- Minion voit les loups sans qu'ils le sachent — asymétrie d'info à gérer côté payload, jamais côté visibilité de tick

## 7. Prochaines étapes suggérées

- [Q1] Je te détaille le schéma Socket.io complet (events client→serveur et serveur→client) pour que tu puisses direct scaffolder avec Claude Code
- [Q2] On part sur juste les 9 rôles de base pour la v1, ou tu veux inclure direct 1-2 rôles Daybreak/Bonus (ex. Village Idiot) pour tester l'extensibilité du state machine ?
- [Q3] Gestion de la reconnexion (un joueur perd sa co pendant la nuit) — tu veux que je couvre ce cas dans la spec ou tu le gères plus tard ?
