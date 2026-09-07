const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomToken(16);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 100_000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$100000$${salt}$${[...new Uint8Array(bits)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, iterations, salt, expected] = encoded.split("$");
  if (!iterations || !salt || !expected) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: Number(iterations), hash: "SHA-256" }, key, 256);
  const actual = [...new Uint8Array(bits)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return actual === expected;
}
