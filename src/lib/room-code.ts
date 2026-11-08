export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function parseRoomCode(input: string, allowLegacy = false) {
  const code = input.trim().toUpperCase();
  if (/^[0-9A-Z]{6}$/.test(code)) return code;
  // Existing invite links and matches remain accessible during the transition.
  if (allowLegacy && /^[0-9A-F]{10}$/.test(code)) return code;
  return null;
}
