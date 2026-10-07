import { type Prisma, type PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { hospitalIsOpen, logoUrl } from '../hospitals/index.js';
import { BedSessionRepository } from './bed-session.repository.js';
import { GuestSessionRepository } from './guest-session.repository.js';

const activityWriteIntervalMs = 60_000;

// Everything a public endpoint may know about the caller. It comes only from
// the server-side GuestSession, never from client input.
export interface GuestContext {
  readonly guestSessionId: string;
  readonly hospitalId: string;
  readonly bedId: string;
  readonly bedSessionId: string;
  readonly expiresAt: Date;
}

export interface GuestLocation {
  readonly hospitalName: string;
  readonly hospitalLogoUrl: string | null;
  readonly bed: { readonly code: string; readonly displayName: string };
  readonly room: string | null;
  readonly ward: string;
  readonly floor: string;
  readonly expiresAt: Date;
}

// Patient access by QR: issuing, checking, and ending guest sessions.
export class GuestSessionService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly ttlMinutes: number,
    private readonly guests = new GuestSessionRepository(),
    private readonly bedSessions = new BedSessionRepository(),
  ) {}

  // Returns null when the bed has no active BedSession.
  public async issue(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedId: string,
  ): Promise<{ token: string; context: GuestContext } | null> {
    const bedSession = await this.bedSessions.findActiveForBed(transaction, hospitalId, bedId);
    if (!bedSession) {
      return null;
    }
    const token = createOpaqueToken();
    const session = await this.guests.create(transaction, {
      hospitalId,
      bedId,
      bedSessionId: bedSession.id,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
    });
    return { token, context: toContext(session) };
  }

  public async authenticate(token: string): Promise<GuestContext> {
    const session = await this.guests.findByTokenHash(this.database, hashOpaqueToken(token));
    const now = new Date();
    // The BedSession check also covers a guest session created in the instant
    // before its BedSession closed.
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.bedSession.status !== 'ACTIVE' ||
      !hospitalIsOpen(session.hospital)
    ) {
      throw new UnauthorizedError();
    }
    if (now.getTime() - session.lastActivityAt.getTime() > activityWriteIntervalMs) {
      await this.guests.touch(this.database, session.id, now);
    }
    return toContext(session);
  }

  public async describe(guest: GuestContext): Promise<GuestLocation> {
    const [hospital, bed] = await this.guests.findPlace(
      this.database,
      guest.hospitalId,
      guest.bedId,
    );
    return {
      hospitalName: hospital.name,
      hospitalLogoUrl: logoUrl(hospital.logo?.publicId),
      bed: { code: bed.code, displayName: bed.displayName },
      room: bed.room?.name ?? null,
      ward: bed.ward.name,
      floor: bed.ward.floor.name,
      expiresAt: guest.expiresAt,
    };
  }

  public revokeForBed(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedId: string,
  ): Promise<number> {
    return this.guests.revokeForBed(transaction, hospitalId, bedId);
  }

  public revokeForBedSession(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedSessionId: string,
  ): Promise<number> {
    return this.guests.revokeForBedSession(transaction, hospitalId, bedSessionId);
  }
}

function toContext(session: {
  id: string;
  hospitalId: string;
  bedId: string;
  bedSessionId: string;
  expiresAt: Date;
}): GuestContext {
  return {
    guestSessionId: session.id,
    hospitalId: session.hospitalId,
    bedId: session.bedId,
    bedSessionId: session.bedSessionId,
    expiresAt: session.expiresAt,
  };
}
