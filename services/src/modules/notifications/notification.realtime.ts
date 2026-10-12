import { type Server as HttpServer } from 'node:http';
import { type PrismaClient } from '@prisma/client';
import { type Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import { StaffAuthService } from '../auth/index.js';
import { NotificationService } from './notification.service.js';
import { NotificationRepository } from './notification.repository.js';

const roomFor = (hospitalId: string, membershipId: string) => `inbox:${hospitalId}:${membershipId}`;

export function createNotificationRealtime(
  server: HttpServer,
  database: PrismaClient,
  origins: readonly string[],
  logger: Logger,
  validationIntervalMs = 30_000,
) {
  const auth = new StaffAuthService(database);
  const identities = new WeakMap<Socket, { hospitalId: string; membershipId: string }>();
  let stopping = false;
  const io = new Server(server, {
    cors: { origin: [...origins], methods: ['GET', 'POST'] },
    maxHttpBufferSize: 4096,
    allowRequest: (request, callback) =>
      callback(null, !request.headers.origin || origins.includes(request.headers.origin)),
  });
  const authenticate = async (socket: Socket) => {
    if (stopping) throw new Error('Unauthorized');
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error('Unauthorized');
    const context = await auth.authenticate(token);
    if (context.mustChangePassword) throw new Error('Unauthorized');
    return context;
  };
  io.use((socket, next) => {
    void authenticate(socket).then(
      (context) => {
        identities.set(socket, {
          hospitalId: context.tenant.hospitalId,
          membershipId: context.membershipId,
        });
        next();
      },
      () => next(new Error('Unauthorized')),
    );
  });
  io.on('connection', (socket) => {
    const identity = identities.get(socket)!;
    identities.delete(socket);
    void socket.join(roomFor(identity.hospitalId, identity.membershipId));
    // No join/subscribe or client notification creation handlers exist.
  });
  let checking: Promise<void> | null = null;
  const validate = () => {
    if (checking) return;
    checking = Promise.all(
      [...io.sockets.sockets.values()].map(async (socket) => {
        try {
          await authenticate(socket);
        } catch {
          socket.disconnect(true);
        }
      }),
    )
      .then(() => undefined)
      .finally(() => {
        checking = null;
      });
  };
  const timer = setInterval(validate, validationIntervalMs);
  timer.unref();
  return {
    io,
    disconnect() {
      stopping = true;
      clearInterval(timer);
      io.disconnectSockets(true);
      io.engine.close();
    },
    async deliver(notification: { id: string; hospitalId: string; membershipId: string }) {
      const room = roomFor(notification.hospitalId, notification.membershipId);
      for (const socket of io.sockets.sockets.values()) {
        if (!socket.rooms.has(room)) continue;
        try {
          const context = await authenticate(socket); // revoke/expiry/reset checked on every emission
          if (
            context.tenant.hospitalId === notification.hospitalId &&
            context.membershipId === notification.membershipId
          ) {
            socket.emit('notification.created', { id: notification.id });
          }
        } catch {
          socket.disconnect(true);
        }
      }
    },
    async stop() {
      stopping = true;
      clearInterval(timer);
      await checking;
      // HTTP has drained before cleanup; close transport resources now.
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
      logger.info('Notification realtime transport stopped');
    },
  };
}

export function startNotificationWorker(
  database: PrismaClient,
  logger: Logger,
  deliver: (notification: {
    id: string;
    hospitalId: string;
    membershipId: string;
  }) => Promise<void>,
  intervalMs = 2000,
) {
  const service = new NotificationService(database, logger);
  const repository = new NotificationRepository();
  let running: Promise<void> | null = null;
  const run = async () => {
    await service.run();
    const pending = await repository.pendingDelivery(database);
    for (const notification of pending) {
      try {
        await deliver(notification);
        // An attempt is not receipt, read status, or request acknowledgement.
        // Offline/missed delivery is recovered by the persistent inbox API.
        await repository.attempted(database, notification.id);
      } catch {
        await repository.retryDelivery(database, notification.id, notification.deliveryAttempts);
        logger.warn(
          { notificationId: notification.id },
          'Realtime notification attempt failed; retry scheduled',
        );
      }
    }
  };
  const tick = () => {
    if (running) return;
    running = run()
      .catch(() => logger.error('Notification worker failed; pending work will be retried'))
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
