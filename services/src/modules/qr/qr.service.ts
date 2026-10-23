import { type BedQrCode, type Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import { hashOpaqueToken } from '../../common/opaque-token.js';
import { developmentQrTokenEncryptionKey } from '../../common/qr-token-encryption.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { hospitalIsOpen } from '../hospitals/index.js';
import { areaFilters } from '../locations/index.js';
import {
  type GuestContext,
  type GuestLocation,
  type GuestSessionService,
} from '../bed-sessions/index.js';
import {
  bedLocationLabel,
  maxBatchLabels,
  type QrBatchIssue,
  type QrBatchResult,
  sortBedsForLabels,
} from './qr-batch.js';
import { type QrCodeView, type QrIssue, QrTokenCodec, toQrCodeView } from './qr-code.js';
import { QrRepository, type QrBatchScope } from './qr.repository.js';

// One response for every failure, so a scan never reveals whether the token,
// bed, session, or hospital exists.
class QrUnavailableError extends AppError {
  public constructor() {
    super(404, 'QR_UNAVAILABLE', 'This QR code is not active. Please ask hospital staff for help.');
  }
}

// Issuing, replacing, and disabling bed QR codes, and exchanging a scanned
// code for a patient guest session.
export class QrCodeService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly guestSessions: GuestSessionService,
    publicAppUrl: string,
    qrTokenEncryptionKey: Buffer = developmentQrTokenEncryptionKey,
    private readonly qrCodes = new QrRepository(),
  ) {
    this.tokens = new QrTokenCodec(publicAppUrl, qrTokenEncryptionKey);
  }

  private readonly tokens: QrTokenCodec;

  public async list(context: StaffContext, filter: { bedId?: string | undefined }) {
    const codes = await this.qrCodes.list(this.database, context.tenant.hospitalId, {
      bedId: filter.bedId,
      wardArea: areaFilters(context, 'bed.read').ward,
    });
    return codes.map(toQrCodeView);
  }

  public generate(context: StaffContext, bedId: string, requestId: string): Promise<QrIssue> {
    const hospitalId = context.tenant.hospitalId;
    const { token, stored } = this.tokens.create();
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
        if ((await this.qrCodes.reissue(transaction, existing, stored)) !== 1) {
          throw new ConflictError();
        }
        qrCode = await this.qrCodes.findById(transaction, existing.id);
      } else {
        // A concurrent first issue fails on the (hospitalId, bedId) unique key.
        qrCode = await this.qrCodes.create(transaction, { hospitalId, bedId, ...stored });
      }

      await recordStaffAudit(transaction, context, requestId, {
        action: 'qr.generate',
        targetType: 'BedQrCode',
        targetId: qrCode.id,
        metadata: { bedId, version: qrCode.version },
      });
      return this.tokens.toIssue(qrCode, token);
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
        const beds = sortBedsForLabels(
          await this.qrCodes.findBedsForLabels(transaction, hospitalId, scope),
        );
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
          const { token, stored } = this.tokens.create();
          const existing = bed.qrCode;
          let qrCode: BedQrCode;
          if (existing?.status === 'ACTIVE') {
            // Same rules as a single rotation: the old label stops working and
            // patients connected through it must scan the new one.
            if ((await this.qrCodes.rotate(transaction, existing, stored)) !== 1) {
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
              if ((await this.qrCodes.reissue(transaction, existing, stored)) !== 1) {
                throw new ConflictError('A bed QR changed. Refresh and retry.');
              }
              qrCode = await this.qrCodes.findById(transaction, existing.id);
            } else {
              qrCode = await this.qrCodes.create(transaction, {
                hospitalId,
                bedId: bed.id,
                ...stored,
              });
            }
            await recordStaffAudit(transaction, context, requestId, {
              action: 'qr.generate',
              targetType: 'BedQrCode',
              targetId: qrCode.id,
              metadata: { bedId: bed.id, version: qrCode.version, batch: true },
            });
          }
          issues.push({
            ...this.tokens.toIssue(qrCode, token),
            bedId: bed.id,
            bedName: bed.displayName,
            bedCode: bed.code,
            location: bedLocationLabel(bed),
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
    const { token, stored } = this.tokens.create();
    return this.database.$transaction(async (transaction) => {
      const existing = await this.requireActive(transaction, hospitalId, bedId);
      if ((await this.qrCodes.rotate(transaction, existing, stored)) !== 1) {
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
      return this.tokens.toIssue(qrCode, token);
    });
  }

  // Returns the same active label without changing its version or ending any
  // patient sessions. Legacy rows have no encrypted token and need one replace.
  public print(context: StaffContext, bedId: string, requestId: string): Promise<QrIssue> {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const qrCode = await this.requireActive(transaction, hospitalId, bedId);
      const token = this.tokens.recover(qrCode);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'qr.print',
        targetType: 'BedQrCode',
        targetId: qrCode.id,
        metadata: { bedId, version: qrCode.version },
      });
      return this.tokens.toIssue(qrCode, token);
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
      return toQrCodeView(await this.qrCodes.findById(transaction, existing.id));
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
}
