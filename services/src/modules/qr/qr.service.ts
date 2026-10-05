import { type BedQrCode, type Prisma, type PrismaClient } from '@prisma/client';
import { AppError, ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';
import {
  type GuestContext,
  type GuestLocation,
  type GuestSessionService,
} from '../bed-sessions/guest-session.service.js';

// One response for every failure, so a scan never reveals whether the token,
// bed, session, or hospital exists.
export class QrUnavailableError extends AppError {
  public constructor() {
    super(404, 'QR_UNAVAILABLE', 'This QR code is not active. Please ask hospital staff for help.');
  }
}

export interface QrIssue {
  readonly qrCode: QrCodeView;
  readonly token: string;
  readonly url: string;
}

export type QrCodeView = Omit<BedQrCode, 'tokenHash'>;

function toView({ tokenHash, ...view }: BedQrCode): QrCodeView {
  void tokenHash;
  return view;
}

export class QrCodeService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly guestSessions: GuestSessionService,
    private readonly publicAppUrl: string,
  ) {}

  public async list(context: StaffContext, filter: { bedId?: string | undefined }) {
    const codes = await this.database.bedQrCode.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.bedId !== undefined ? { bedId: filter.bedId } : {}),
      },
      orderBy: { issuedAt: 'desc' },
    });
    return codes.map(toView);
  }

  public generate(context: StaffContext, bedId: string, requestId: string): Promise<QrIssue> {
    const hospitalId = context.tenant.hospitalId;
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    return this.database.$transaction(async (transaction) => {
      const bed = await transaction.bed.findUnique({
        where: { hospitalId_id: { hospitalId, id: bedId } },
      });
      if (!bed) {
        throw new NotFoundError('The referenced bed was not found.');
      }
      if (!bed.active) {
        throw new ConflictError('Activate the bed before issuing a QR code.');
      }
      const existing = await transaction.bedQrCode.findUnique({
        where: { hospitalId_bedId: { hospitalId, bedId } },
      });
      if (existing?.status === 'ACTIVE') {
        throw new ConflictError('This bed already has an active QR code. Rotate it instead.');
      }

      let qrCode: BedQrCode;
      if (existing) {
        // Re-issue after revocation; the version guard rejects a concurrent re-issue.
        const reissued = await transaction.bedQrCode.updateMany({
          where: { id: existing.id, status: 'REVOKED', version: existing.version },
          data: {
            tokenHash,
            status: 'ACTIVE',
            version: existing.version + 1,
            issuedAt: new Date(),
            revokedAt: null,
          },
        });
        if (reissued.count !== 1) {
          throw new ConflictError();
        }
        qrCode = await transaction.bedQrCode.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        // A concurrent first issue fails on the (hospitalId, bedId) unique key.
        qrCode = await transaction.bedQrCode.create({ data: { hospitalId, bedId, tokenHash } });
      }

      await recordStaffAudit(transaction, context, requestId, {
        action: 'qr.generate',
        targetType: 'BedQrCode',
        targetId: qrCode.id,
        metadata: { bedId, version: qrCode.version },
      });
      return this.toIssue(qrCode, token);
    });
  }

  public rotate(context: StaffContext, bedId: string, requestId: string): Promise<QrIssue> {
    const hospitalId = context.tenant.hospitalId;
    const token = createOpaqueToken();
    return this.database.$transaction(async (transaction) => {
      const existing = await this.requireActive(transaction, hospitalId, bedId);
      const rotated = await transaction.bedQrCode.updateMany({
        where: { id: existing.id, status: 'ACTIVE', version: existing.version },
        data: {
          tokenHash: hashOpaqueToken(token),
          version: existing.version + 1,
          issuedAt: new Date(),
          rotatedAt: new Date(),
        },
      });
      if (rotated.count !== 1) {
        throw new ConflictError();
      }
      // A rotated code may have leaked, so sessions opened with it end too.
      const revokedGuestSessions = await this.guestSessions.revokeForBed(
        transaction,
        hospitalId,
        bedId,
      );
      const qrCode = await transaction.bedQrCode.findUniqueOrThrow({ where: { id: existing.id } });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'qr.rotate',
        targetType: 'BedQrCode',
        targetId: qrCode.id,
        metadata: {
          bedId,
          fromVersion: existing.version,
          toVersion: qrCode.version,
          revokedGuestSessions,
        },
      });
      return this.toIssue(qrCode, token);
    });
  }

  public revoke(context: StaffContext, bedId: string, requestId: string): Promise<QrCodeView> {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const existing = await this.requireActive(transaction, hospitalId, bedId);
      const revoked = await transaction.bedQrCode.updateMany({
        where: { id: existing.id, status: 'ACTIVE', version: existing.version },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        throw new ConflictError();
      }
      const revokedGuestSessions = await this.guestSessions.revokeForBed(
        transaction,
        hospitalId,
        bedId,
      );
      await recordStaffAudit(transaction, context, requestId, {
        action: 'qr.revoke',
        targetType: 'BedQrCode',
        targetId: existing.id,
        metadata: { bedId, version: existing.version, revokedGuestSessions },
      });
      return toView(await transaction.bedQrCode.findUniqueOrThrow({ where: { id: existing.id } }));
    });
  }

  // Public: exchanges a scanned QR token for a short-lived guest session.
  public async resolve(
    token: string,
  ): Promise<{ guestToken: string; guest: GuestContext; location: GuestLocation }> {
    const qrCode = await this.database.bedQrCode.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: {
        hospital: { select: { status: true } },
        bed: { select: { active: true } },
      },
    });
    if (
      !qrCode ||
      qrCode.status !== 'ACTIVE' ||
      qrCode.hospital.status !== 'ACTIVE' ||
      !qrCode.bed.active
    ) {
      throw new QrUnavailableError();
    }
    const issued = await this.guestSessions.issue(qrCode.hospitalId, qrCode.bedId);
    if (!issued) {
      throw new QrUnavailableError();
    }
    return {
      guestToken: issued.token,
      guest: issued.context,
      location: await this.guestSessions.describe(issued.context),
    };
  }

  private async requireActive(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    bedId: string,
  ): Promise<BedQrCode> {
    const existing = await transaction.bedQrCode.findUnique({
      where: { hospitalId_bedId: { hospitalId, bedId } },
    });
    if (!existing) {
      throw new NotFoundError('This bed has no QR code.');
    }
    if (existing.status !== 'ACTIVE') {
      throw new ConflictError('This QR code is revoked. Generate a new one instead.');
    }
    return existing;
  }

  private toIssue(qrCode: BedQrCode, token: string): QrIssue {
    return { qrCode: toView(qrCode), token, url: `${this.publicAppUrl}/q/${token}` };
  }
}
