import pino, { type DestinationStream, type Logger } from 'pino';

const redactedPaths = [
  'err.body',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.referer',
  'req.query',
  'password',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.temporaryPassword',
  'token',
  '*.token',
  'qrToken',
  '*.qrToken',
  'sessionToken',
  '*.sessionToken',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    redact: {
      paths: redactedPaths,
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
