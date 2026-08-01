import type { PublicPlayer } from "@onuw/shared";

export interface RoleScreenProps<TResult> {
  playerId: string;
  players: PublicPlayer[];
  result: TResult | null;
  onSubmit: (params: Record<string, unknown>) => void;
  onContinue: () => void;
}
