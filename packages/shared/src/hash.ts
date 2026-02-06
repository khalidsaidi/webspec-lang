import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bytesToHex(sha256(bytes));
}
