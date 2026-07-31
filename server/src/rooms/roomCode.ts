import { customAlphabet } from "nanoid";

// Drops 0/O and 1/I — the two pairs players most often misread off a small screen.
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const nanoid = customAlphabet(ROOM_CODE_ALPHABET, 5);

export function generateRoomCode(): string {
  return nanoid();
}
