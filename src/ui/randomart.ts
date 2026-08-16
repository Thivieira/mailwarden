/**
 * OpenSSH "drunken bishop" randomart, as drawn by `ssh-keygen -lv`.
 *
 * A deterministic visual hash: the same bytes always draw the same picture, and a
 * different request draws a visibly different one. On the authorize page it renders a
 * fingerprint of the exact OAuth request being granted, so a returning user recognizes
 * their own vault's art and a forged page cannot reproduce it without the same inputs.
 *
 * This is a real fingerprint rendering, not decoration — never draw it from anything
 * other than the bytes actually being attested.
 */

const FIELD_WIDTH = 17;
const FIELD_HEIGHT = 9;

// OpenSSH's augmentation string. Index 15 marks the start cell, 16 the end cell;
// visit counts above 14 clamp to '^'.
const SYMBOLS = " .o+=*BOX@%&#/^SE";

export function randomart(bytes: Uint8Array): string[] {
  const field = Array.from({ length: FIELD_HEIGHT }, () => new Array<number>(FIELD_WIDTH).fill(0));

  let x = Math.floor(FIELD_WIDTH / 2);
  let y = Math.floor(FIELD_HEIGHT / 2);

  for (const byte of bytes) {
    // Four moves per byte, two bits at a time, least significant first.
    for (let shift = 0; shift < 8; shift += 2) {
      const pair = (byte >> shift) & 0b11;
      x += (pair & 0b01) === 0 ? -1 : 1;
      y += (pair & 0b10) === 0 ? -1 : 1;
      x = Math.min(FIELD_WIDTH - 1, Math.max(0, x));
      y = Math.min(FIELD_HEIGHT - 1, Math.max(0, y));
      if (field[y]![x]! < SYMBOLS.length - 3) field[y]![x]!++;
    }
  }

  const startX = Math.floor(FIELD_WIDTH / 2);
  const startY = Math.floor(FIELD_HEIGHT / 2);
  field[startY]![startX] = SYMBOLS.length - 2; // 'S'
  field[y]![x] = SYMBOLS.length - 1; // 'E'

  return field.map((row) => row.map((count) => SYMBOLS[count]!).join(""));
}

/** SHA-256 the input, then draw its randomart. Returns the rows and the hex digest. */
export async function fingerprint(input: string): Promise<{ rows: string[]; hex: string }> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  );
  const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { rows: randomart(digest), hex };
}

/** Group a hex digest into colon-separated pairs, the way ssh-keygen prints one. */
export function groupHex(hex: string, groups = 8): string {
  return (hex.match(/.{2}/g) ?? []).slice(0, groups).join(":");
}

/** Centers a label inside a dash rule of the field's width, as ssh-keygen frames its art. */
function rule(label: string): string {
  const inner = `[${label}]`;
  const pad = FIELD_WIDTH - inner.length;
  const left = Math.floor(pad / 2);
  return `+${"-".repeat(left)}${inner}${"-".repeat(pad - left)}+`;
}

/**
 * The full framed artifact, borders included. Unframed rows read as stray characters;
 * the frame is what makes this legible as a fingerprint rather than decoration.
 */
export function frame(rows: string[], head = "MAILWARDEN", foot = "SHA256"): string {
  return [rule(head), ...rows.map((row) => `|${row}|`), rule(foot)].join("\n");
}
