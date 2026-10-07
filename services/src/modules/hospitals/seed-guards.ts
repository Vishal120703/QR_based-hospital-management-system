// Seed scripts write dummy logins and history: never against a shared server.
export function requireLocalDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new SeedInputError('Seeding is limited to a local PostgreSQL database.');
  }
}

export class SeedInputError extends Error {}
