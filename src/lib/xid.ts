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

export function xIdToEmail(normalized: string): string {
  return `${normalized}@810day.local`;
}

// Deterministic per-x_id password. The security model is "X ID only" auth,
// documented in security memory.
export function xIdToPassword(normalized: string): string {
  return `810day-lock-v1-${normalized}-kuji`;
}
