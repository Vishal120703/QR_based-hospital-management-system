import pino, { type Logger } from 'pino';

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'qrToken',
  '*.qrToken',
  'sessionToken',
  '*.sessionToken',
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: redactedPaths,
      censor: '[REDACTED]',
    },
  });
}
