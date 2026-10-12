import { type Server } from 'node:http';
import { type Logger } from 'pino';

// Starting and stopping the HTTP server safely: a clear message when the
// port is taken, and a graceful shutdown that stops taking new requests, lets
// the ones in progress finish (up to a time limit), and only then closes the
// worker and database connections, once, however many signals arrive.

export class StartupError extends Error {}

// Resolves once the server listens; a busy or forbidden port becomes a
// StartupError with a plain explanation (no stack trace needed).
export function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: NodeJS.ErrnoException) => {
      server.off('listening', listening);
      if (error.code === 'EADDRINUSE') {
        reject(
          new StartupError(
            `Port ${port} is already in use. Stop the other program using it, or set PORT to a free port.`,
          ),
        );
      } else if (error.code === 'EACCES') {
        reject(
          new StartupError(`Not allowed to listen on port ${port}. Choose a port above 1024.`),
        );
      } else {
        reject(error);
      }
    };
    const listening = () => {
      server.off('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen(port, host);
  });
}

// Runs each step in order, even if one fails; failures are logged.
export async function runCleanups(
  steps: readonly { name: string; run: () => Promise<unknown> }[],
  logger: Logger,
): Promise<void> {
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      logger.error({ err: error, step: step.name }, 'Shutdown step failed');
    }
  }
}

// Returns the shutdown function. The first call does the work; later calls
// (a second signal) get the same promise.
export function gracefulShutdown(options: {
  server: Server;
  logger: Logger;
  timeoutMs: number;
  // After the server has stopped: for example the worker, then the database.
  cleanups: readonly { name: string; run: () => Promise<unknown> }[];
}): (reason: string) => Promise<void> {
  let done: Promise<void> | null = null;
  return (reason) => {
    if (done) {
      options.logger.info({ reason }, 'Already shutting down');
      return done;
    }
    options.logger.info({ reason }, 'Shutting down API');
    done = (async () => {
      await new Promise<void>((resolve) => {
        if (!options.server.listening) {
          resolve();
          return;
        }
        // Too slow: end the connections still open.
        const forced = setTimeout(() => {
          options.logger.warn('Requests still running at the shutdown time limit; ending them');
          options.server.closeAllConnections();
        }, options.timeoutMs);
        forced.unref();
        // Stops new connections, closes idle keep-alive ones, and calls back
        // once the requests in progress have finished.
        options.server.close(() => {
          clearTimeout(forced);
          resolve();
        });
        options.server.closeIdleConnections();
      });
      await runCleanups(options.cleanups, options.logger);
      options.logger.info('API stopped');
    })();
    return done;
  };
}
