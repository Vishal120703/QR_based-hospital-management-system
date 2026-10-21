import { type BedSession, type Prisma, type PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { hospitalIsOpen, logoUrl } from '../hospitals/index.js';
import { BedSessionRepository } from './bed-session.repository.js';
import { GuestSessionRepository } from './guest-session.repository.js';
import { bedTakesPatients } from './patient-access.js';

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

  // Returns null when patients cannot use the bed now: with bed occupancy
  // management on, only an admitted bed can; with it off, any bed in service,
  // and the scan opens the bed's stay itself. The caller holds the bed's QR
  // row lock, so two scans of one bed run one after the other.
  public async issue(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedId: string,
  ): Promise<{ token: string; context: GuestContext } | null> {
    const occupancyManaged = await this.bedSessions.lockOccupancySetting(transaction, hospitalId);
    const bed = await this.bedSessions.findBedState(transaction, hospitalId, bedId);
    if (occupancyManaged === null || !bed || !bedTakesPatients(bed, occupancyManaged)) {
      return null;
    }
    let bedSession = await this.bedSessions.findActiveForBed(transaction, hospitalId, bedId);
    if (!occupancyManaged) {
      bedSession = await this.stayForScan(transaction, hospitalId, bedId, bedSession);
    }
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

  public revokeForBedSessions(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedSessionIds: readonly string[],
  ): Promise<number> {
    return this.guests.revokeForBedSessions(transaction, hospitalId, bedSessionIds);
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

  // Without admissions the QR belongs to the bed. A scan joins the bed's stay
  // while it is in use (someone connected within the guest session lifetime,
  // or a request still open); otherwise it starts a fresh stay, so the next
  // patient never sees the previous patient's requests.
  private async stayForScan(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedId: string,
    current: BedSession | null,
  ): Promise<BedSession> {
    if (
      current &&
      (await this.bedSessions.inUse(transaction, hospitalId, current.id, new Date()))
    ) {
      return current;
    }
    if (current) {
      await this.bedSessions.closeMany(transaction, hospitalId, [current.id], null);
    }
    return this.bedSessions.create(transaction, { hospitalId, bedId, startedByMembershipId: null });
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
