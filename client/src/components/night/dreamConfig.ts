import type { NightTickId } from "@onuw/shared";

/**
 * What a sleeping player does during someone else's turn.
 *
 * Two problems to solve at once. The first is boredom: the old sleeping
 * screen was a sentence and a single "Continuer à dormir" button, so most
 * of the night was spent holding a dead phone. The second is secrecy: any
 * difference in shape between the acting screen and the sleeping one is a
 * tell readable from across the table.
 *
 * Both are answered the same way — the sleeping player performs the *same
 * gestures* as the acting one. Same grids, same number of taps, same final
 * unveil. Nothing they tap is sent anywhere, and no dream ever names a
 * role, so nothing here can be mistaken for real information.
 */
export type DreamStep =
  | { kind: "wait"; text: string }
  | { kind: "players"; prompt: string; picks: number; hints: string[] }
  | { kind: "center"; prompt: string; picks: number; hints: string[] }
  | { kind: "playersOrCenter"; prompt: string; centerLabel: string; hints: string[] };

export interface DreamConfig {
  /** Mirrors the acting screen's flow, step for step. */
  steps: DreamStep[];
  /** The unveil at the end. Dream imagery only — never a role, never a name. */
  visions: string[];
}

export const DREAM_CONFIG: Record<NightTickId, DreamConfig> = {
  doppelganger: {
    steps: [
      {
        kind: "players",
        prompt: "Dans ton rêve, un visage se penche sur toi. Lequel ?",
        picks: 1,
        hints: ["Choisis un visage"],
      },
    ],
    visions: [
      "Il portait ton visage.",
      "Il t'a souri, puis il s'est retourné.",
      "Tu n'arrives plus à te rappeler ses traits.",
    ],
  },
  werewolf: {
    steps: [{ kind: "wait", text: "Quelque chose respire au fond du couloir…" }],
    visions: [
      "Un chien aboie très loin, puis se tait.",
      "La porte de la grange bat toute seule.",
      "Des pas dans la neige, sous ta fenêtre.",
    ],
  },
  minion: {
    steps: [{ kind: "wait", text: "On chuchote sous ta fenêtre…" }],
    visions: [
      "Deux voix, et aucun mot que tu comprennes.",
      "Une lanterne s'éloigne vers les bois.",
      "Quelqu'un a compté jusqu'à trois, très bas.",
    ],
  },
  mason: {
    steps: [{ kind: "wait", text: "Deux mains se cherchent dans le noir…" }],
    visions: [
      "Une poignée de main que tu n'as pas donnée.",
      "Une pierre gravée, sous tes doigts.",
      "Un signe que tu ne connais pas.",
    ],
  },
  seer: {
    steps: [
      {
        kind: "playersOrCenter",
        prompt: "Dans ton rêve, tu veux voir quelqu'un. Qui ?",
        centerLabel: "Regarder vers la table",
        hints: ["Choisis un visage"],
      },
    ],
    visions: [
      "Le visage était retourné.",
      "Tu as vu de l'eau noire, et rien d'autre.",
      "La carte était blanche des deux côtés.",
    ],
  },
  robber: {
    steps: [
      {
        kind: "players",
        prompt: "Dans ton rêve, tu tends la main vers quelqu'un. Qui ?",
        picks: 1,
        hints: ["Choisis un visage"],
      },
    ],
    visions: [
      "Ta main s'est refermée sur du vide.",
      "Tu as pris quelque chose, et tu l'as reposé.",
      "Tes poches sont pleines de terre.",
    ],
  },
  troublemaker: {
    steps: [
      {
        kind: "players",
        prompt: "Dans ton rêve, deux ombres changent de place. Lesquelles ?",
        picks: 2,
        hints: ["Désigne la première ombre", "Désigne la seconde ombre"],
      },
    ],
    visions: [
      "Elles ont ri, et rien n'a bougé.",
      "Tu ne sais plus laquelle était laquelle.",
      "Le plancher a craqué deux fois.",
    ],
  },
  drunk: {
    steps: [
      {
        kind: "center",
        prompt: "Dans ton rêve, trois cartes flottent au-dessus de la table :",
        picks: 1,
        hints: ["Attrape-en une"],
      },
    ],
    visions: [
      "Elle t'a filé entre les doigts.",
      "Le dos de la carte était couvert de mousse.",
      "Elle était trop lourde pour du carton.",
    ],
  },
  insomniac: {
    steps: [{ kind: "wait", text: "Tu remues dans ton sommeil…" }],
    visions: [
      "Tu t'es réveillé une seconde, puis plus rien.",
      "Le plafond n'était pas à la bonne hauteur.",
      "Ta propre main t'a semblé étrangère.",
    ],
  },
  doppelgangerInsomniac: {
    steps: [{ kind: "wait", text: "Tu remues dans ton sommeil…" }],
    visions: [
      "Quelqu'un dormait déjà à ta place.",
      "Tu t'es vu de dos, dans l'embrasure.",
      "Le lit était encore chaud.",
    ],
  },
};

/**
 * Which line a given player dreams this tick.
 *
 * Deterministic in the tick so a re-render doesn't reshuffle mid-dream, but
 * varied across a night so the sleeping screens don't become one repeated
 * sentence — the exact complaint that made the old dummy screen feel dead.
 */
export function visionFor(tickId: NightTickId, seed: number): string {
  const visions = DREAM_CONFIG[tickId].visions;
  return visions[Math.abs(seed) % visions.length];
}
