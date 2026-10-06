import { type Prisma, type PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { logoUrl } from '../hospitals/logo.js';

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

export class GuestSessionService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly ttlMinutes: number,
  ) {}

  // Returns null when the bed has no active BedSession.
  public async issue(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedId: string,
  ): Promise<{ token: string; context: GuestContext } | null> {
    const bedSession = await transaction.bedSession.findFirst({
      where: { hospitalId, bedId, status: 'ACTIVE' },
    });
    if (!bedSession) {
      return null;
    }
    const token = createOpaqueToken();
    const session = await transaction.guestSession.create({
      data: {
        hospitalId,
        bedId,
        bedSessionId: bedSession.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
      },
    });
    return { token, context: toContext(session) };
  }

  public async authenticate(token: string): Promise<GuestContext> {
    const session = await this.database.guestSession.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: {
        bedSession: { select: { status: true } },
        hospital: { select: { status: true } },
      },
    });
    const now = new Date();
    // The BedSession check also covers a guest session created in the instant
    // before its BedSession closed.
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.bedSession.status !== 'ACTIVE' ||
      session.hospital.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedError();
    }
    if (now.getTime() - session.lastActivityAt.getTime() > activityWriteIntervalMs) {
      await this.database.guestSession.updateMany({
        where: { id: session.id },
        data: { lastActivityAt: now },
      });
    }
    return toContext(session);
  }

  public async describe(guest: GuestContext): Promise<GuestLocation> {
    const [hospital, bed] = await Promise.all([
      this.database.hospital.findUniqueOrThrow({
        where: { id: guest.hospitalId },
        select: { name: true, logo: { select: { publicId: true } } },
      }),
      this.database.bed.findUniqueOrThrow({
        where: { hospitalId_id: { hospitalId: guest.hospitalId, id: guest.bedId } },
        select: {
          code: true,
          displayName: true,
          room: { select: { name: true } },
          ward: { select: { name: true, floor: { select: { name: true } } } },
        },
      }),
    ]);
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

  public async revokeForBed(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedId: string,
  ): Promise<number> {
    const revoked = await transaction.guestSession.updateMany({
      where: { hospitalId, bedId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return revoked.count;
  }

  public async revokeForBedSession(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedSessionId: string,
  ): Promise<number> {
    const revoked = await transaction.guestSession.updateMany({
      where: { hospitalId, bedSessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return revoked.count;
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
