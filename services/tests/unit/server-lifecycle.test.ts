import { createServer, request, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/config/logger.js';
import {
  gracefulShutdown,
  listen,
  runCleanups,
  StartupError,
} from '../../src/http/server-lifecycle.js';

const logger = createLogger('silent');
const servers: Server[] = [];
const portOf = (server: Server) => (server.address() as AddressInfo).port;

// A server whose /slow answers only when `release` is called.
function slowServer() {
  let release: () => void = () => undefined;
  const server = createServer((incoming, response) => {
    if (incoming.url === '/slow') {
      release = () => response.end('done');
    } else {
      response.end('fast');
    }
  });
  servers.push(server);
  return { server, release: () => release() };
}

function get(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    request({ port, path, host: '127.0.0.1', agent: false }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString()));
      response.on('end', () => resolve(body));
    })
      .on('error', reject)
      .end();
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('Starting the server', () => {
  it('explains plainly when the port is already in use', async () => {
    const first = slowServer().server;
    await listen(first, 0, '127.0.0.1');
    const second = slowServer().server;
    const failure = listen(second, portOf(first), '127.0.0.1');
    await expect(failure).rejects.toBeInstanceOf(StartupError);
    await expect(failure).rejects.toThrow(/already in use/);
  });
});

describe('Shutting down', () => {
  it('lets a request in progress finish, refuses new ones, then closes the rest in order', async () => {
    const { server, release } = slowServer();
    await listen(server, 0, '127.0.0.1');
    const port = portOf(server);
    const order: string[] = [];
    const shutdown = gracefulShutdown({
      server,
      logger,
      timeoutMs: 5_000,
      cleanups: [
        { name: 'worker', run: () => Promise.resolve(order.push('worker')) },
        { name: 'database', run: () => Promise.resolve(order.push('database')) },
      ],
    });

    const inProgress = get(port, '/slow');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stopping = shutdown('SIGTERM');
    // A second signal does not start a second shutdown.
    expect(shutdown('SIGINT')).toBe(stopping);
    await expect(get(port, '/fast')).rejects.toThrow();
    expect(order).toEqual([]);

    release();
    expect(await inProgress).toBe('done');
    await stopping;
    expect(order).toEqual(['worker', 'database']);
    expect(server.listening).toBe(false);
  });

  it('ends requests still running at the time limit, and still cleans up', async () => {
    const { server } = slowServer();
    await listen(server, 0, '127.0.0.1');
    let cleaned = false;
    const shutdown = gracefulShutdown({
      server,
      logger,
      timeoutMs: 100,
      cleanups: [{ name: 'database', run: () => Promise.resolve((cleaned = true)) }],
    });
    const stuck = get(portOf(server), '/slow');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await shutdown('SIGTERM');
    await expect(stuck).rejects.toThrow();
    expect(cleaned).toBe(true);
  });

  it('keeps cleaning up when one step fails', async () => {
    const done: string[] = [];
    await runCleanups(
      [
        { name: 'worker', run: () => Promise.reject(new Error('stuck')) },
        { name: 'database', run: () => Promise.resolve(done.push('database')) },
      ],
      logger,
    );
    expect(done).toEqual(['database']);
  });
});
