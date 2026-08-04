import { createContext } from "react";

/**
 * True while a role screen is being rendered *inside* the Doppelganger's
 * chain (you copied the Seer, so now you play the Seer).
 *
 * The Doppelganger already shows "Tu as copié : Voyante" above the
 * sub-action, so the chained screen must not also announce "Voyante" as its
 * own kicker — two role names stacked on one screen is exactly how a player
 * loses track of which rules they're following mid-tick.
 */
export const ChainedRoleContext = createContext(false);
