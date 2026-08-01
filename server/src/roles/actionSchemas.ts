import { z } from "zod";
import type { NightTickId } from "../night/nightOrder.js";

const centerIndexSchema = z.number().int().min(0).max(2);
const playerIdSchema = z.string().min(1);

export const actionParamsSchemas: Record<NightTickId, z.ZodTypeAny> = {
  doppelganger: z.object({
    targetPlayerId: playerIdSchema,
    subParams: z.record(z.string(), z.unknown()).optional(),
  }),
  werewolf: z.object({ centerIndex: centerIndexSchema.optional() }),
  minion: z.object({}),
  mason: z.object({}),
  seer: z.union([
    z.object({ mode: z.literal("player"), targetPlayerId: playerIdSchema }),
    z.object({ mode: z.literal("center"), centerIndices: z.tuple([centerIndexSchema, centerIndexSchema]) }),
  ]),
  robber: z.object({ targetPlayerId: playerIdSchema }),
  troublemaker: z.object({ targetAId: playerIdSchema, targetBId: playerIdSchema }),
  drunk: z.object({ centerIndex: centerIndexSchema }),
  insomniac: z.object({}),
  doppelgangerInsomniac: z.object({}),
};
