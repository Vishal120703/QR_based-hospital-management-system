import { type BedQrCode, type Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';
import { areaFilters } from '../locations/location.service.js';
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

export const maxBatchLabels = 300;

export type QrBatchScope =
  | { readonly kind: 'HOSPITAL' }
  | { readonly kind: 'BUILDING' | 'FLOOR' | 'WARD' | 'ROOM'; readonly id: string }
  | { readonly kind: 'BEDS'; readonly bedIds: readonly string[] };

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

function scopeWhere(scope: QrBatchScope): Prisma.BedWhereInput {
  switch (scope.kind) {
    case 'HOSPITAL':
      return {};
    case 'BUILDING':
      return { ward: { floor: { buildingId: scope.id } } };
    case 'FLOOR':
      return { ward: { floorId: scope.id } };
    case 'WARD':
      return { wardId: scope.id };
    case 'ROOM':
      return { roomId: scope.id };
    case 'BEDS':
      return { id: { in: [...scope.bedIds] } };
  }
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
        bed: { ward: areaFilters(context, 'bed.read').ward },
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
        await this.requireScope(transaction, hospitalId, scope);
        const beds = await transaction.bed.findMany({
          where: { hospitalId, ...scopeWhere(scope) },
          include: {
            qrCode: true,
            room: { select: { code: true, name: true } },
            ward: {
              select: {
                code: true,
                name: true,
                floor: {
                  select: {
                    code: true,
                    name: true,
                    level: true,
                    building: { select: { code: true, name: true } },
                  },
                },
              },
            },
          },
        });
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
            const rotated = await transaction.bedQrCode.updateMany({
              where: { id: existing.id, status: 'ACTIVE', version: existing.version },
              data: {
                tokenHash,
                version: existing.version + 1,
                issuedAt: new Date(),
                rotatedAt: new Date(),
              },
            });
            if (rotated.count !== 1)
              throw new ConflictError('A bed QR changed. Refresh and retry.');
            const revokedGuestSessions = await this.guestSessions.revokeForBed(
              transaction,
              hospitalId,
              bed.id,
            );
            qrCode = await transaction.bedQrCode.findUniqueOrThrow({ where: { id: existing.id } });
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
                throw new ConflictError('A bed QR changed. Refresh and retry.');
              }
              qrCode = await transaction.bedQrCode.findUniqueOrThrow({
                where: { id: existing.id },
              });
            } else {
              qrCode = await transaction.bedQrCode.create({
                data: { hospitalId, bedId: bed.id, tokenHash },
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
    const issued = await this.database.$transaction(async (transaction) => {
      const tokenHash = hashOpaqueToken(token);
      // Credential resolution is the pre-tenant lookup. Rotation and revocation
      // update this same row, so they cannot miss a guest issued from an old QR
      // between checking its token and committing the guest session.
      const locked = await transaction.$queryRaw<Array<{ id: string; hospitalId: string }>>`
        SELECT "id", "hospitalId" FROM "BedQrCode"
        WHERE "tokenHash" = ${tokenHash} AND "status" = 'ACTIVE'
        FOR UPDATE
      `;
      const key = locked[0];
      if (!key) {
        throw new QrUnavailableError();
      }
      const qrCode = await transaction.bedQrCode.findUnique({
        where: { hospitalId_id: { hospitalId: key.hospitalId, id: key.id } },
        include: {
          hospital: { select: { status: true } },
          bed: { select: { active: true } },
        },
      });
      if (!qrCode || qrCode.hospital.status !== 'ACTIVE' || !qrCode.bed.active) {
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

  private async requireScope(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    scope: QrBatchScope,
  ): Promise<void> {
    const key = (id: string) => ({ where: { hospitalId_id: { hospitalId, id } } });
    let found: boolean;
    switch (scope.kind) {
      case 'HOSPITAL':
        found = true;
        break;
      case 'BUILDING':
        found = Boolean(await transaction.building.findUnique(key(scope.id)));
        break;
      case 'FLOOR':
        found = Boolean(await transaction.floor.findUnique(key(scope.id)));
        break;
      case 'WARD':
        found = Boolean(await transaction.ward.findUnique(key(scope.id)));
        break;
      case 'ROOM':
        found = Boolean(await transaction.room.findUnique(key(scope.id)));
        break;
      case 'BEDS': {
        const ids = [...new Set(scope.bedIds)];
        found =
          (await transaction.bed.count({ where: { hospitalId, id: { in: ids } } })) === ids.length;
        break;
      }
    }
    if (!found) throw new NotFoundError('That location was not found.');
  }

  private toIssue(qrCode: BedQrCode, token: string): QrIssue {
    return { qrCode: toView(qrCode), token, url: `${this.publicAppUrl}/q/${token}` };
  }
}
