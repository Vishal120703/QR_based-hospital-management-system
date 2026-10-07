import { type BedQrCode, type Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { hospitalIsOpen } from '../hospitals/index.js';
import { areaFilters } from '../locations/index.js';
import {
  type GuestContext,
  type GuestLocation,
  type GuestSessionService,
} from '../bed-sessions/index.js';
import { QrRepository, type QrBatchScope } from './qr.repository.js';

// One response for every failure, so a scan never reveals whether the token,
// bed, session, or hospital exists.
class QrUnavailableError extends AppError {
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

const maxBatchLabels = 300;

export interface QrBatchIssue extends QrIssue {
  readonly bedId: string;
  readonly bedName: string;
  readonly bedCode: string;
  readonly location: string;
}

export interface QrBatchResult {
  readonly issues: QrBatchIssue[];
  readonly totalBeds: number;
  readonly replaced: number;
  readonly skippedActive: number;
  readonly skippedInactive: number;
}

interface LocatedBed {
  code: string;
  room: { code: string } | null;
  ward: {
    code: string;
    floor: { code: string; level: number | null; building: { code: string } | null };
  };
}

const naturally = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Building, floor level, ward, room, then bed, with "Bed 2" before "Bed 10".
function byLocation(left: LocatedBed, right: LocatedBed): number {
  const levelOf = (bed: LocatedBed) => bed.ward.floor.level ?? Number.MAX_SAFE_INTEGER;
  return (
    naturally.compare(
      left.ward.floor.building?.code ?? '~',
      right.ward.floor.building?.code ?? '~',
    ) ||
    levelOf(left) - levelOf(right) ||
    naturally.compare(left.ward.floor.code, right.ward.floor.code) ||
    naturally.compare(left.ward.code, right.ward.code) ||
    naturally.compare(left.room?.code ?? '', right.room?.code ?? '') ||
    naturally.compare(left.code, right.code)
  );
}

function toView({ tokenHash, ...view }: BedQrCode): QrCodeView {
  void tokenHash;
  return view;
}

// Issuing, replacing, and disabling bed QR codes, and exchanging a scanned
// code for a patient guest session.
export class QrCodeService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly guestSessions: GuestSessionService,
    private readonly publicAppUrl: string,
    private readonly qrCodes = new QrRepository(),
  ) {}

  public async list(context: StaffContext, filter: { bedId?: string | undefined }) {
    const codes = await this.qrCodes.list(this.database, context.tenant.hospitalId, {
      bedId: filter.bedId,
      wardArea: areaFilters(context, 'bed.read').ward,
    });
    return codes.map(toView);
  }

  public generate(context: StaffContext, bedId: string, requestId: string): Promise<QrIssue> {
    const hospitalId = context.tenant.hospitalId;
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    return this.database.$transaction(async (transaction) => {
      const bed = await this.qrCodes.findBed(transaction, hospitalId, bedId);
      if (!bed) {
        throw new NotFoundError('The referenced bed was not found.');
      }
      if (!bed.active) {
        throw new ConflictError('Activate the bed before issuing a QR code.');
      }
      const existing = await this.qrCodes.findForBed(transaction, hospitalId, bedId);
      if (existing?.status === 'ACTIVE') {
        throw new ConflictError('This bed already has an active QR code. Rotate it instead.');
      }

      let qrCode: BedQrCode;
      if (existing) {
        // Re-issue after revocation; the version guard rejects a concurrent re-issue.
        if ((await this.qrCodes.reissue(transaction, existing, tokenHash)) !== 1) {
          throw new ConflictError();
        }
        qrCode = await this.qrCodes.findById(transaction, existing.id);
      } else {
        // A concurrent first issue fails on the (hospitalId, bedId) unique key.
        qrCode = await this.qrCodes.create(transaction, { hospitalId, bedId, tokenHash });
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

  // Issues QR codes for every active bed in an area (or a list of beds), in
  // location order so printed labels come out bed by bed. Beds that already
  // have an active code are skipped unless replaceExisting rotates them.
  public async generateBatch(
    context: StaffContext,
    scope: QrBatchScope,
    replaceExisting: boolean,
    requestId: string,
  ): Promise<QrBatchResult> {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        if (!(await this.qrCodes.scopeExists(transaction, hospitalId, scope))) {
          throw new NotFoundError('That location was not found.');
        }
        const beds = await this.qrCodes.findBedsForLabels(transaction, hospitalId, scope);
        beds.sort(byLocation);
        const eligible = beds.filter(
          (bed) => bed.active && (replaceExisting || bed.qrCode?.status !== 'ACTIVE'),
        );
        if (eligible.length > maxBatchLabels) {
          throw new InvalidInputError(
            `This area has ${eligible.length} beds to print. Choose a smaller area (up to ${maxBatchLabels} at a time).`,
          );
        }

        const issues: QrBatchIssue[] = [];
        let replaced = 0;
        for (const bed of eligible) {
          const token = createOpaqueToken();
          const tokenHash = hashOpaqueToken(token);
          const existing = bed.qrCode;
          let qrCode: BedQrCode;
          if (existing?.status === 'ACTIVE') {
            // Same rules as a single rotation: the old label stops working and
            // patients connected through it must scan the new one.
            if ((await this.qrCodes.rotate(transaction, existing, tokenHash)) !== 1) {
              throw new ConflictError('A bed QR changed. Refresh and retry.');
            }
            const revokedGuestSessions = await this.guestSessions.revokeForBed(
              transaction,
              hospitalId,
              bed.id,
            );
            qrCode = await this.qrCodes.findById(transaction, existing.id);
            replaced += 1;
            await recordStaffAudit(transaction, context, requestId, {
              action: 'qr.rotate',
              targetType: 'BedQrCode',
              targetId: qrCode.id,
              metadata: {
                bedId: bed.id,
                fromVersion: existing.version,
                toVersion: qrCode.version,
                revokedGuestSessions,
                batch: true,
              },
            });
          } else {
            if (existing) {
              if ((await this.qrCodes.reissue(transaction, existing, tokenHash)) !== 1) {
                throw new ConflictError('A bed QR changed. Refresh and retry.');
              }
              qrCode = await this.qrCodes.findById(transaction, existing.id);
            } else {
              qrCode = await this.qrCodes.create(transaction, {
                hospitalId,
                bedId: bed.id,
                tokenHash,
              });
            }
            await recordStaffAudit(transaction, context, requestId, {
              action: 'qr.generate',
              targetType: 'BedQrCode',
              targetId: qrCode.id,
              metadata: { bedId: bed.id, version: qrCode.version, batch: true },
            });
          }
          const floor = bed.ward.floor;
          issues.push({
            ...this.toIssue(qrCode, token),
            bedId: bed.id,
            bedName: bed.displayName,
            bedCode: bed.code,
            location: [floor.building?.name, floor.name, bed.ward.name, bed.room?.name]
              .filter(Boolean)
              .join(' · '),
          });
        }
        return {
          issues,
          totalBeds: beds.length,
          replaced,
          skippedActive: replaceExisting
            ? 0
            : beds.filter((bed) => bed.active && bed.qrCode?.status === 'ACTIVE').length,
          skippedInactive: beds.filter((bed) => !bed.active).length,
        };
      },
      { timeout: 60_000 },
    );
  }

  public rotate(context: StaffContext, bedId: string, requestId: string): Promise<QrIssue> {
    const hospitalId = context.tenant.hospitalId;
    const token = createOpaqueToken();
    return this.database.$transaction(async (transaction) => {
      const existing = await this.requireActive(transaction, hospitalId, bedId);
      if ((await this.qrCodes.rotate(transaction, existing, hashOpaqueToken(token))) !== 1) {
        throw new ConflictError();
      }
      // A rotated code may have leaked, so sessions opened with it end too.
      const revokedGuestSessions = await this.guestSessions.revokeForBed(
        transaction,
        hospitalId,
        bedId,
      );
      const qrCode = await this.qrCodes.findById(transaction, existing.id);
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
      if ((await this.qrCodes.revoke(transaction, existing)) !== 1) {
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
      return toView(await this.qrCodes.findById(transaction, existing.id));
    });
  }

  // Public: exchanges a scanned QR token for a short-lived guest session.
  public async resolve(
    token: string,
  ): Promise<{ guestToken: string; guest: GuestContext; location: GuestLocation }> {
    const issued = await this.database.$transaction(async (transaction) => {
      const key = await this.qrCodes.lockActiveByTokenHash(transaction, hashOpaqueToken(token));
      if (!key) {
        throw new QrUnavailableError();
      }
      const qrCode = await this.qrCodes.findForScan(transaction, key.hospitalId, key.id);
      if (!qrCode || !hospitalIsOpen(qrCode.hospital) || !qrCode.bed.active) {
        throw new QrUnavailableError();
      }
      const session = await this.guestSessions.issue(transaction, qrCode.hospitalId, qrCode.bedId);
      if (!session) {
        throw new QrUnavailableError();
      }
      return session;
    });
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
    const existing = await this.qrCodes.findForBed(transaction, hospitalId, bedId);
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
