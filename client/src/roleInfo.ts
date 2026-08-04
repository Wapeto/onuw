import type { RoleId } from "@onuw/shared";

export type RoleTeam = "village" | "werewolf" | "tanner";

export interface RoleInfo {
  team: RoleTeam;
  /** How this player wins. One sentence, second person. */
  goal: string;
  /** Exactly what will be asked of them during the night. */
  night: string;
  /** The one thing that stops a first-timer playing the role backwards. */
  tip: string;
}

export const TEAM_LABELS: Record<RoleTeam, string> = {
  village: "Village",
  werewolf: "Loups-Garous",
  tanner: "Tanneur",
};

/**
 * What each card actually asks of the player, in the words they need before
 * the night starts rather than during it.
 *
 * The first playtest failed on exactly this: cards were dealt and the first
 * tick armed in the same instant, so players met their role for the first
 * time as a five-second prompt in the dark. Every entry answers the three
 * questions asked at the table — what am I, what will I be asked to do, and
 * what does winning mean for me.
 */
export const ROLE_INFO: Record<RoleId, RoleInfo> = {
  doppelganger: {
    team: "village",
    goal: "Tu deviens le rôle que tu copies, et tu gagnes avec le camp de ce rôle.",
    night: "Tout au début de la nuit, tu regardes la carte d'un autre joueur. Tu deviens ce rôle et tu fais son action tout de suite.",
    tip: "Personne ne sait ce que tu as copié. À toi de décider si tu le révèles.",
  },
  werewolf: {
    team: "werewolf",
    goal: "Ton camp gagne si aucun Loup-Garou n'est éliminé au vote.",
    night: "Tu ouvres les yeux et tu vois les autres Loups. Si tu es le seul Loup, tu regardes une carte du centre.",
    tip: "Fais-toi passer pour un villageois. Choisis ton faux rôle tôt et ne te contredis pas.",
  },
  minion: {
    team: "werewolf",
    goal: "Tu gagnes avec les Loups, même si c'est toi qui es éliminé.",
    night: "Tu découvres qui sont les Loups-Garous. Eux ne savent pas qui tu es.",
    tip: "Te faire éliminer à leur place est une victoire : tant qu'aucun Loup ne meurt, ton camp gagne.",
  },
  mason: {
    team: "village",
    goal: "Village : faire éliminer un Loup-Garou au vote.",
    night: "Tu vois l'autre Franc-Maçon. Si tu ne vois personne, c'est que l'autre carte est au centre.",
    tip: "Vous êtes l'alibi l'un de l'autre — mais l'annoncer trop tôt fait de vous deux des cibles faciles.",
  },
  seer: {
    team: "village",
    goal: "Village : faire éliminer un Loup-Garou au vote.",
    night: "Tu regardes soit la carte d'un joueur, soit deux cartes du centre.",
    tip: "Ton information est la plus forte du jeu. Un Loup se fera passer pour toi : prépare-toi à le contredire.",
  },
  robber: {
    team: "village",
    goal: "Tu gagnes avec le camp de la carte que tu as volée, pas avec celui du Voleur.",
    night: "Tu échanges ta carte avec celle d'un joueur, puis tu regardes ton nouveau rôle.",
    tip: "Tu n'es plus Voleur. Si tu as volé un Loup, tu es un Loup et tu joues avec eux.",
  },
  troublemaker: {
    team: "village",
    goal: "Village : faire éliminer un Loup-Garou au vote.",
    night: "Tu échanges les cartes de deux autres joueurs, sans les regarder.",
    tip: "Tu es le seul à savoir que ces deux-là ne sont plus ce qu'ils croient être. Ta propre carte, elle, n'a pas bougé.",
  },
  drunk: {
    team: "village",
    goal: "Tu gagnes avec le camp de ta nouvelle carte — que tu ne verras jamais.",
    night: "Tu échanges ta carte avec une carte du centre, sans la regarder.",
    tip: "Tu ne sais plus ce que tu es, et c'est normal. Le dire franchement est souvent ta meilleure défense.",
  },
  insomniac: {
    team: "village",
    goal: "Village : faire éliminer un Loup-Garou au vote.",
    night: "À la toute fin de la nuit, tu regardes ta propre carte pour voir si elle a changé.",
    tip: "Si ta carte a changé, quelqu'un t'a touché pendant la nuit. C'est une information que personne d'autre n'a.",
  },
  villager: {
    team: "village",
    goal: "Village : faire éliminer un Loup-Garou au vote.",
    night: "Tu dors toute la nuit. Tu n'auras aucune information.",
    tip: "N'avoir rien vu est difficile à prouver — et c'est aussi ce que dira un Loup. Fais parler les autres.",
  },
  hunter: {
    team: "village",
    goal: "Village : faire éliminer un Loup-Garou au vote.",
    night: "Tu dors toute la nuit.",
    tip: "Si tu es éliminé, le joueur pour qui tu as voté est éliminé avec toi. Ton vote est une arme, vise juste.",
  },
  tanner: {
    team: "tanner",
    goal: "Tu gagnes seul, et uniquement si c'est toi qui es éliminé au vote.",
    night: "Tu dors toute la nuit.",
    tip: "Fais-toi suspecter sans en faire trop : un Tanneur qui joue trop mal n'est jamais voté.",
  },
  villageIdiot: {
    team: "village",
    goal: "Village : faire éliminer un Loup-Garou au vote.",
    night: "Tu dors toute la nuit.",
    tip: "Aucune information, aucun pouvoir : ta voix pendant la discussion est tout ce que tu as.",
  },
};

export function roleInfo(roleId: RoleId): RoleInfo {
  return ROLE_INFO[roleId];
}
