import type { NightTickId } from "@onuw/shared";

export interface DummyConfig {
  prompt: string;
  buttonLabel: string;
}

export const DUMMY_CONFIG: Record<NightTickId, DummyConfig> = {
  doppelganger: { prompt: "Quelqu'un d'autre agit cette nuit.", buttonLabel: "Continuer à dormir" },
  werewolf: { prompt: "Les Loups-Garous se regardent.", buttonLabel: "Continuer à dormir" },
  minion: { prompt: "Le Sbire découvre les Loups.", buttonLabel: "Continuer à dormir" },
  mason: { prompt: "Les Francs-Maçons se reconnaissent.", buttonLabel: "Continuer à dormir" },
  seer: { prompt: "La Voyante regarde une carte.", buttonLabel: "Continuer à dormir" },
  robber: { prompt: "Le Voleur échange une carte.", buttonLabel: "Continuer à dormir" },
  troublemaker: { prompt: "La Semeuse de troubles échange deux cartes.", buttonLabel: "Continuer à dormir" },
  drunk: { prompt: "L'Ivrogne échange sa carte avec le centre.", buttonLabel: "Continuer à dormir" },
  insomniac: { prompt: "L'Insomniaque regarde sa carte.", buttonLabel: "Continuer à dormir" },
  doppelgangerInsomniac: { prompt: "Le Double regarde sa carte.", buttonLabel: "Continuer à dormir" },
};
