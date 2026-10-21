import { z } from 'zod';
import {
  decodeQrTokenEncryptionKey,
  developmentQrTokenEncryptionKey,
} from '../common/qr-token-encryption.js';

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

function protocolOf(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

function databaseUsesTls(value: string): boolean {
  try {
    return ['require', 'verify-ca', 'verify-full'].includes(
      new URL(value).searchParams.get('sslmode') ?? '',
    );
  } catch {
    return false;
  }
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: connectionUrl(['postgresql:', 'postgres:']),
    // 32 random bytes in Base64. It protects the recoverable copy used only
    // when an authorized manager reprints an active bedside QR.
    QR_TOKEN_ENCRYPTION_KEY: optional(
      z.string().refine((value) => decodeQrTokenEncryptionKey(value) !== null, {
        message: 'Expected a Base64-encoded 32-byte key.',
      }),
    ),
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
    // How often the SLA worker checks for overdue requests to escalate; 0
    // turns it off in this process (another one must then run it).
    ESCALATION_INTERVAL_SECONDS: optional(z.coerce.number().int().min(0).max(3600)),
    // On SIGTERM/SIGINT, how long requests in progress may take to finish
    // before their connections are closed. Keep it under the host's own
    // limit (Render waits 30 seconds).
    SHUTDOWN_TIMEOUT_SECONDS: optional(z.coerce.number().int().min(1).max(120)),
    // Operational records are removed by the in-process retention worker.
    SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(180),
    // Audit retention is a governance decision, so production must choose it
    // explicitly instead of silently inheriting a legally arbitrary default.
    AUDIT_RETENTION_DAYS: optional(z.coerce.number().int().min(30).max(3650)),
    RETENTION_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.PUBLIC_APP_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_APP_URL'],
        message: 'PUBLIC_APP_URL (the web app address) is required in production.',
      });
    }
    if (value.NODE_ENV === 'production' && !value.QR_TOKEN_ENCRYPTION_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['QR_TOKEN_ENCRYPTION_KEY'],
        message: 'QR_TOKEN_ENCRYPTION_KEY is required in production.',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.PUBLIC_APP_URL &&
      protocolOf(value.PUBLIC_APP_URL) !== 'https:'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_APP_URL'],
        message: 'PUBLIC_APP_URL must use HTTPS in production.',
      });
    }
    if (value.NODE_ENV === 'production' && !databaseUsesTls(value.DATABASE_URL)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must include sslmode=require (or stronger) in production.',
      });
    }
    if (value.NODE_ENV === 'production' && value.CORS_ORIGINS) {
      for (const origin of value.CORS_ORIGINS.split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        if (protocolOf(origin) !== 'https:') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['CORS_ORIGINS'],
            message: 'Every CORS_ORIGINS entry must use HTTPS in production.',
          });
          break;
        }
      }
    }
    if (value.NODE_ENV === 'production' && !value.AUDIT_RETENTION_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUDIT_RETENTION_DAYS'],
        message: 'AUDIT_RETENTION_DAYS must be chosen explicitly in production.',
      });
    }
  });

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly databaseUrl: string;
  readonly qrTokenEncryptionKey: Buffer;
  readonly redisUrl: string | null;
  readonly publicAppUrl: string;
  readonly corsOrigins: readonly string[];
  readonly trustProxy: number;
  readonly guestSessionTtlMinutes: number;
  readonly escalationIntervalSeconds: number;
  readonly shutdownTimeoutSeconds: number;
  readonly sessionRetentionDays: number;
  readonly notificationRetentionDays: number;
  readonly auditRetentionDays: number | null;
  readonly retentionIntervalHours: number;
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
    qrTokenEncryptionKey: parsed.QR_TOKEN_ENCRYPTION_KEY
      ? decodeQrTokenEncryptionKey(parsed.QR_TOKEN_ENCRYPTION_KEY)!
      : developmentQrTokenEncryptionKey,
    redisUrl: parsed.REDIS_URL ?? null,
    publicAppUrl,
    corsOrigins: [...new Set([originOf(publicAppUrl), ...extraOrigins])],
    trustProxy: parsed.TRUST_PROXY ?? (parsed.NODE_ENV === 'production' ? 1 : 0),
    guestSessionTtlMinutes: parsed.GUEST_SESSION_TTL_MINUTES,
    // A blank value means the default, never "off".
    escalationIntervalSeconds: parsed.ESCALATION_INTERVAL_SECONDS ?? 60,
    shutdownTimeoutSeconds: parsed.SHUTDOWN_TIMEOUT_SECONDS ?? 10,
    sessionRetentionDays: parsed.SESSION_RETENTION_DAYS,
    notificationRetentionDays: parsed.NOTIFICATION_RETENTION_DAYS,
    auditRetentionDays: parsed.AUDIT_RETENTION_DAYS ?? null,
    retentionIntervalHours: parsed.RETENTION_INTERVAL_HOURS,
  };
}
