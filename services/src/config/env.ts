import { z } from 'zod';

const connectionUrl = (protocols: readonly string[]) =>
  z
    .string()
    .url()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;
        return protocols.includes(protocol);
      },
      { message: `Expected protocol: ${protocols.join(' or ')}` },
    );

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: connectionUrl(['postgresql:', 'postgres:']),
  REDIS_URL: connectionUrl(['redis:', 'rediss:']),
  // Base URL of the frontend; printed QR codes link to <PUBLIC_APP_URL>/q/<token>.
  PUBLIC_APP_URL: connectionUrl(['http:', 'https:']).default('http://localhost:5173'),
  GUEST_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly publicAppUrl: string;
  readonly guestSessionTtlMinutes: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    publicAppUrl: parsed.PUBLIC_APP_URL.replace(/\/+$/, ''),
    guestSessionTtlMinutes: parsed.GUEST_SESSION_TTL_MINUTES,
  };
}
