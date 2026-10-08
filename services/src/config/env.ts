import { z } from 'zod';

const connectionUrl = (protocols: readonly string[]) =>
  z
    .string()
    .url()
    .refine(
      (value) => {
        // .url() reports a malformed value; this check only names the protocol.
        try {
          return protocols.includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      { message: `Expected protocol: ${protocols.join(' or ')}` },
    );

// An empty value counts as not set, as hosting dashboards often save "".
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: connectionUrl(['postgresql:', 'postgres:']),
    // Optional: nothing needs Redis yet. When set, it must be reachable at
    // start-up and is part of the /ready check.
    REDIS_URL: optional(connectionUrl(['redis:', 'rediss:'])),
    // Base URL of the web app; printed QR codes link to <PUBLIC_APP_URL>/q/<token>.
    PUBLIC_APP_URL: optional(connectionUrl(['http:', 'https:'])),
    // Other web origins allowed to call the API, comma-separated (for example
    // a preview deployment). The PUBLIC_APP_URL origin is always allowed.
    CORS_ORIGINS: optional(z.string()),
    // How many proxies sit in front of the API, so rate limits see each
    // visitor's own address: 3 on Render (Cloudflare, Render's load balancer,
    // and a local proxy). "0" when the API is reached directly. Defaults to 1
    // in production, 0 otherwise.
    TRUST_PROXY: optional(z.coerce.number().int().min(0).max(5)),
    GUEST_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.PUBLIC_APP_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_APP_URL'],
        message: 'PUBLIC_APP_URL (the web app address) is required in production.',
      });
    }
  });

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly databaseUrl: string;
  readonly redisUrl: string | null;
  readonly publicAppUrl: string;
  readonly corsOrigins: readonly string[];
  readonly trustProxy: number;
  readonly guestSessionTtlMinutes: number;
}

// "https://app.example.com/" → "https://app.example.com" (what browsers send).
function originOf(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: `Not a web origin: ${value}`,
      },
    ]);
  }
  return url.origin;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const publicAppUrl = (parsed.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const extraOrigins = (parsed.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(originOf);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL ?? null,
    publicAppUrl,
    corsOrigins: [...new Set([originOf(publicAppUrl), ...extraOrigins])],
    trustProxy: parsed.TRUST_PROXY ?? (parsed.NODE_ENV === 'production' ? 1 : 0),
    guestSessionTtlMinutes: parsed.GUEST_SESSION_TTL_MINUTES,
  };
}
