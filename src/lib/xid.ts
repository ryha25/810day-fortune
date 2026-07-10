export function normalizeXId(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function displayXId(input: string): string {
  const n = input.trim().replace(/^@+/, "");
  return n;
}

export function isValidXId(input: string): boolean {
  const n = normalizeXId(input);
  return /^[a-z0-9_]{1,15}$/.test(n);
}
