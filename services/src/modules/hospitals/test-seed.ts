import { randomBytes, randomUUID } from 'node:crypto';
import {
  type Prisma,
  type PrismaClient,
  type RequestActorType,
  type RequestEventType,
  type RequestStatus,
  type ScopeType,
} from '@prisma/client';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { hashPassword } from '../auth/password.js';
import { type BootstrapCreatedHospital, bootstrapHospital } from './bootstrap.js';
import { demoHospital, seedDemoPlatformAdmin } from './demo-seed.js';
import { storeLogo } from './logo.js';
import { placeholderLogo } from './placeholder-logo.js';
import {
  type HospitalSpec,
  type PersonSpec,
  type RequestSpec,
  type Scope,
  type Step,
  testHospitalSpecs,
  type When,
} from './test-seed-data.js';

// Builds the dummy client hospitals in test-seed-data.ts, writing the same
// rows (requests, append-only events, audit entries) that the real services
// write, but with past timestamps so Reports and the Audit log have history.

const minute = 60_000;
const day = 24 * 60 * minute;
// Every test hospital uses Asia/Kolkata (UTC+05:30, no daylight saving).
const hospitalOffset = 330 * minute;
const timezone = 'Asia/Kolkata';

export function resolveWhen(now: Date, when: When): Date {
  if (typeof when === 'number') return new Date(now.getTime() - when * minute);
  const [daysAgo, time] = when;
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const midnight = Math.floor((now.getTime() + hospitalOffset) / day) * day - hospitalOffset;
  return new Date(midnight - daysAgo * day + (hours * 60 + minutes) * minute);
}

// Repeatable pseudo-random numbers, so every run builds the same history.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const moves: Record<
  Step['do'],
  { from: readonly RequestStatus[]; to: RequestStatus; event: RequestEventType }
> = {
  assign: { from: ['SUBMITTED'], to: 'ASSIGNED', event: 'ASSIGNED' },
  accept: { from: ['ASSIGNED'], to: 'ACCEPTED', event: 'ACCEPTED' },
  start: { from: ['ACCEPTED'], to: 'IN_PROGRESS', event: 'STARTED' },
  complete: { from: ['IN_PROGRESS'], to: 'COMPLETED', event: 'COMPLETED' },
  close: { from: ['COMPLETED'], to: 'CLOSED', event: 'CLOSED' },
  cancel: { from: ['SUBMITTED', 'ASSIGNED'], to: 'CANCELLED', event: 'CANCELLED' },
  reject: { from: ['ASSIGNED'], to: 'REJECTED', event: 'REJECTED' },
  transfer: { from: ['ACCEPTED', 'IN_PROGRESS'], to: 'ASSIGNED', event: 'TRANSFERRED' },
};
const activeStatuses: readonly RequestStatus[] = [
  'SUBMITTED',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
];
const patientReasons = ['Not needed any more', 'Family helped', 'Asked a nurse directly'];

interface BedInfo {
  readonly id: string;
  readonly wardCode: string;
  readonly floorKey: string;
}
interface StayInfo {
  readonly id: string;
  readonly bed: string;
  readonly from: Date;
  readonly to: Date | null;
  readonly guestSessionId: string;
}
interface ServiceInfo {
  readonly id: string;
  readonly name: string;
  readonly categoryName: string;
  readonly departmentId: string;
  readonly departmentCode: string;
  readonly priority: Prisma.ServiceRequestCreateManyInput['priority'];
  readonly slaPolicyId: string;
  readonly slaPolicyVersionId: string;
  readonly slaPolicyVersion: number;
  readonly acceptMinutes: number;
  readonly completeMinutes: number;
  escalationPolicyId: string | null;
}

class HospitalSeeder {
  private readonly audits: Prisma.AuditLogCreateManyInput[] = [];
  private readonly members = new Map<string, string>();
  private readonly departments = new Map<string, string>();
  private readonly roles = new Map<string, string>();
  private readonly floors = new Map<string, string>();
  private readonly wards = new Map<string, string>();
  private readonly beds = new Map<string, BedInfo>();
  private readonly services = new Map<string, ServiceInfo>();
  private readonly stays: StayInfo[] = [];
  private readonly random = seededRandom(20_261_006);
  private readonly start: Date;
  private setupStep = 0;

  public constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly spec: HospitalSpec,
    private readonly created: BootstrapCreatedHospital,
    private readonly now: Date,
    private readonly platformUserId: string | null,
    private readonly passwordHashes: ReadonlyMap<string, string>,
  ) {
    this.start = this.at(spec.createdAt);
  }

  private get hospitalId(): string {
    return this.created.hospitalId;
  }

  private get manager(): PersonSpec {
    return this.spec.people[0]!;
  }

  private at(when: When): Date {
    return resolveWhen(this.now, when);
  }

  // Setup happens on the hospital's first day, one minute after another.
  private setupTime(): Date {
    this.setupStep += 1;
    return new Date(this.start.getTime() + 60 * minute + this.setupStep * minute);
  }

  private member(key: string): string {
    const id = this.members.get(key);
    if (!id) throw new Error(`Test data names an unknown person "${key}".`);
    return id;
  }

  private person(key: string): PersonSpec {
    const found = this.spec.people.find((person) => person.key === key);
    if (!found) throw new Error(`Test data names an unknown person "${key}".`);
    return found;
  }

  private required<T>(map: ReadonlyMap<string, T>, key: string, kind: string): T {
    const value = map.get(key);
    if (value === undefined) throw new Error(`Test data names an unknown ${kind} "${key}".`);
    return value;
  }

  private audit(
    at: Date,
    actor: string,
    action: string,
    target: { type: string; id: string },
    metadata: Prisma.InputJsonObject = {},
  ): void {
    if (actor === 'platform' && !this.platformUserId) return;
    this.audits.push({
      hospitalId: this.hospitalId,
      actorType: actor === 'system' ? 'SYSTEM' : actor === 'platform' ? 'PLATFORM' : 'STAFF',
      actorMembershipId: actor === 'system' || actor === 'platform' ? null : this.member(actor),
      actorPlatformUserId: actor === 'platform' ? this.platformUserId : null,
      action,
      targetType: target.type,
      targetId: target.id,
      metadata,
      requestId: randomUUID(),
      createdAt: at,
    });
  }

  public async run(): Promise<void> {
    const hospitalTarget = { type: 'Hospital', id: this.hospitalId };
    await this.transaction.hospital.update({
      where: { id: this.hospitalId },
      data: { createdAt: this.start },
    });
    await this.transaction.auditLog.updateMany({
      where: { hospitalId: this.hospitalId, action: 'hospital.bootstrap' },
      data: { createdAt: this.start },
    });
    await this.transaction.client.update({
      where: { id: this.created.clientId },
      data: { createdAt: this.start },
    });
    this.members.set(this.manager.key, this.created.adminMembershipId);
    this.audit(this.start, 'platform', 'platform.client.create', hospitalTarget, {
      clientId: this.created.clientId,
      name: this.spec.client.name,
    });
    this.audit(this.start, 'platform', 'platform.hospital.create', hospitalTarget, {
      code: this.spec.code,
      managerEmail: this.email(this.manager),
      clientId: this.created.clientId,
    });
    const logo = await storeLogo(
      this.transaction,
      this.hospitalId,
      placeholderLogo(this.spec.logo.color, this.spec.logo.shape),
    );
    this.audit(
      new Date(this.start.getTime() + 5 * minute),
      'platform',
      'platform.hospital.logo',
      hospitalTarget,
      { contentType: logo.contentType, byteSize: logo.byteSize },
    );

    await this.addDepartmentsAndRoles();
    await this.addCatalog();
    await this.addLocations();
    await this.addPeople();
    await this.addStays();
    await this.addRequests();
    await this.addShifts();

    await this.transaction.hospitalSetting.create({
      data: {
        hospitalId: this.hospitalId,
        key: 'demo.seed',
        value: { version: 1, purpose: 'full-manual-testing' },
      },
    });
    this.audit(this.start, 'system', 'demo.seed', hospitalTarget, { dataset: 'full-manual-test' });
    await this.transaction.auditLog.createMany({ data: this.audits });
  }

  public email(person: PersonSpec): string {
    return `${person.email}@${this.spec.domain}`;
  }

  private async addDepartmentsAndRoles(): Promise<void> {
    for (const [code, name] of this.spec.extraDepartments ?? []) {
      const department = await this.transaction.department.create({
        data: { hospitalId: this.hospitalId, code, name },
      });
      this.audit(
        this.setupTime(),
        this.manager.key,
        'department.create',
        { type: 'Department', id: department.id },
        { after: { code, name, active: true } },
      );
    }
    for (const department of await this.transaction.department.findMany({
      where: { hospitalId: this.hospitalId },
    })) {
      this.departments.set(department.code, department.id);
    }

    for (const role of this.spec.customRoles ?? []) {
      const created = await this.transaction.role.create({
        data: {
          hospitalId: this.hospitalId,
          name: role.name,
          description: role.description,
          scopeLevel: role.scopeLevel,
        },
      });
      await this.transaction.rolePermission.createMany({
        data: role.permissions.map((permissionKey) => ({
          hospitalId: this.hospitalId,
          roleId: created.id,
          permissionKey,
        })),
      });
      this.audit(
        this.setupTime(),
        this.manager.key,
        'role.create',
        { type: 'Role', id: created.id },
        { name: role.name, scopeLevel: role.scopeLevel, permissionKeys: [...role.permissions] },
      );
    }
    for (const role of await this.transaction.role.findMany({
      where: { hospitalId: this.hospitalId },
    })) {
      // Built-in roles are found by key; custom roles and escalation targets by name.
      if (role.systemKey) this.roles.set(role.systemKey, role.id);
      this.roles.set(role.name, role.id);
    }
  }

  private async addCatalog(): Promise<void> {
    const catalog = this.spec.catalog;
    for (const sla of catalog?.slas ?? []) {
      const policy = await this.transaction.slaPolicy.create({
        data: {
          hospitalId: this.hospitalId,
          name: sla.name,
          versions: {
            create: {
              version: 1,
              acceptMinutes: sla.acceptMinutes,
              completeMinutes: sla.completeMinutes,
              createdByMembershipId: this.created.adminMembershipId,
            },
          },
        },
      });
      this.audit(
        this.setupTime(),
        this.manager.key,
        'sla.create',
        { type: 'SlaPolicy', id: policy.id },
        { after: { version: 1, ...sla } },
      );
    }
    for (const category of catalog?.categories ?? []) {
      const created = await this.transaction.serviceCategory.create({
        data: { hospitalId: this.hospitalId, ...category },
      });
      this.audit(
        this.setupTime(),
        this.manager.key,
        'serviceCategory.create',
        { type: 'ServiceCategory', id: created.id },
        { after: { name: category.name } },
      );
    }
    const [categories, policies] = await Promise.all([
      this.transaction.serviceCategory.findMany({ where: { hospitalId: this.hospitalId } }),
      this.transaction.slaPolicy.findMany({ where: { hospitalId: this.hospitalId } }),
    ]);
    const categoryId = new Map(categories.map((category) => [category.name, category.id]));
    const policyId = new Map(policies.map((policy) => [policy.name, policy.id]));
    for (const [index, service] of (catalog?.services ?? []).entries()) {
      const created = await this.transaction.serviceItem.create({
        data: {
          hospitalId: this.hospitalId,
          name: service.name,
          priority: service.priority,
          active: service.active ?? true,
          sortOrder: 100 + index * 10,
          categoryId: this.required(categoryId, service.category, 'category'),
          departmentId: this.required(this.departments, service.department, 'department'),
          slaPolicyId: this.required(policyId, service.sla, 'response target'),
        },
      });
      this.audit(
        this.setupTime(),
        this.manager.key,
        'service.create',
        { type: 'ServiceItem', id: created.id },
        { after: { name: service.name, active: service.active ?? true } },
      );
    }

    const escalation = catalog?.escalation;
    if (escalation) {
      const policy = await this.transaction.escalationPolicy.create({
        data: { hospitalId: this.hospitalId, name: escalation.name },
      });
      await this.transaction.escalationLevel.createMany({
        data: escalation.levels.map((level, index) => ({
          hospitalId: this.hospitalId,
          escalationPolicyId: policy.id,
          level: index + 1,
          afterMinutes: level.afterMinutes,
          targetType: level.target === 'ASSIGNEE' ? ('ASSIGNEE' as const) : ('ROLE' as const),
          roleId:
            level.target === 'ASSIGNEE' ? null : this.required(this.roles, level.target, 'role'),
        })),
      });
      await this.transaction.serviceItem.updateMany({
        where: { hospitalId: this.hospitalId, name: { in: [...escalation.services] } },
        data: { escalationPolicyId: policy.id },
      });
      this.audit(
        this.setupTime(),
        this.manager.key,
        'escalation.create',
        { type: 'EscalationPolicy', id: policy.id },
        { after: { name: escalation.name, levels: escalation.levels.length } },
      );
    }

    const items = await this.transaction.serviceItem.findMany({
      where: { hospitalId: this.hospitalId },
      include: {
        category: { select: { name: true } },
        department: { select: { code: true } },
        slaPolicy: { include: { versions: { where: { version: 1 } } } },
      },
    });
    for (const item of items) {
      const version = item.slaPolicy.versions[0];
      if (!version) throw new Error(`Response target for ${item.name} has no version 1.`);
      this.services.set(item.name, {
        id: item.id,
        name: item.name,
        categoryName: item.category.name,
        departmentId: item.departmentId,
        departmentCode: item.department.code,
        priority: item.priority,
        slaPolicyId: item.slaPolicyId,
        slaPolicyVersionId: version.id,
        slaPolicyVersion: version.version,
        acceptMinutes: version.acceptMinutes,
        completeMinutes: version.completeMinutes,
        escalationPolicyId: item.escalationPolicyId,
      });
    }
  }

  private async addLocations(): Promise<void> {
    const occupied = new Set(this.spec.stays.filter((stay) => !stay.to).map((stay) => stay.bed));
    const buildings = new Map<string, string>();
    for (const floorSpec of this.spec.floors) {
      let buildingId: string | null = null;
      if (floorSpec.building) {
        buildingId = buildings.get(floorSpec.building.code) ?? null;
        if (!buildingId) {
          const building = await this.transaction.building.create({
            data: { hospitalId: this.hospitalId, ...floorSpec.building },
          });
          buildingId = building.id;
          buildings.set(floorSpec.building.code, building.id);
          this.audit(
            this.setupTime(),
            this.manager.key,
            'building.create',
            { type: 'Building', id: building.id },
            { after: floorSpec.building },
          );
        }
      }
      const floor = await this.transaction.floor.create({
        data: {
          hospitalId: this.hospitalId,
          buildingId,
          code: floorSpec.code,
          name: floorSpec.name,
          level: floorSpec.level,
        },
      });
      this.floors.set(floorSpec.key, floor.id);
      this.audit(
        this.setupTime(),
        this.manager.key,
        'floor.create',
        { type: 'Floor', id: floor.id },
        { after: { code: floorSpec.code, name: floorSpec.name, level: floorSpec.level } },
      );

      for (const wardSpec of floorSpec.wards) {
        const ward = await this.transaction.ward.create({
          data: {
            hospitalId: this.hospitalId,
            floorId: floor.id,
            code: wardSpec.code,
            name: wardSpec.name,
            unitType: wardSpec.unitType,
          },
        });
        this.wards.set(wardSpec.code, ward.id);
        this.audit(
          this.setupTime(),
          this.manager.key,
          'ward.create',
          { type: 'Ward', id: ward.id },
          { after: { code: wardSpec.code, name: wardSpec.name, unitType: wardSpec.unitType } },
        );
        const groups = [
          { roomId: null as string | null, beds: wardSpec.beds ?? [] },
          ...(await Promise.all(
            (wardSpec.rooms ?? []).map(async (roomSpec) => {
              const room = await this.transaction.room.create({
                data: {
                  hospitalId: this.hospitalId,
                  wardId: ward.id,
                  code: roomSpec.code,
                  name: roomSpec.name,
                  roomType: roomSpec.roomType,
                },
              });
              return { roomId: room.id, beds: roomSpec.beds };
            }),
          )),
        ];
        const bedCodes: string[] = [];
        for (const group of groups) {
          for (const bedSpec of group.beds) {
            const bed = await this.transaction.bed.create({
              data: {
                hospitalId: this.hospitalId,
                wardId: ward.id,
                roomId: group.roomId,
                code: bedSpec.code,
                displayName: bedSpec.name,
                bedType: bedSpec.type ?? 'STANDARD',
                status: bedSpec.maintenance
                  ? 'MAINTENANCE'
                  : occupied.has(bedSpec.code)
                    ? 'OCCUPIED'
                    : 'AVAILABLE',
              },
            });
            this.beds.set(bedSpec.code, {
              id: bed.id,
              wardCode: wardSpec.code,
              floorKey: floorSpec.key,
            });
            bedCodes.push(bedSpec.code);
          }
        }
        this.audit(
          this.setupTime(),
          this.manager.key,
          'bed.bulk_create',
          { type: 'Ward', id: ward.id },
          {
            mode: wardSpec.rooms ? 'rooms' : 'numbered',
            roomCodes: (wardSpec.rooms ?? []).map((room) => room.code),
            bedCodes,
          },
        );
      }
    }
  }

  private scope(scope: Scope): { scopeType: ScopeType; scopeId: string } {
    if (scope === 'hospital') return { scopeType: 'HOSPITAL', scopeId: this.hospitalId };
    const [kind = '', key = ''] = scope.split(/:(.*)/);
    if (kind === 'floor') {
      return { scopeType: 'FLOOR', scopeId: this.required(this.floors, key, 'floor') };
    }
    if (kind === 'ward') {
      return { scopeType: 'WARD', scopeId: this.required(this.wards, key, 'ward') };
    }
    return {
      scopeType: 'DEPARTMENT',
      scopeId: this.required(this.departments, key, 'department'),
    };
  }

  private async addPeople(): Promise<void> {
    for (const person of this.spec.people.slice(1)) {
      const createdAt = this.setupTime();
      const user = await this.transaction.user.create({
        data: {
          email: this.email(person),
          displayName: person.name,
          passwordHash: this.required(this.passwordHashes, person.key, 'password for'),
          createdAt,
        },
      });
      const offAt = person.wentOffDuty ? this.at(person.wentOffDuty.at) : null;
      const membership = await this.transaction.hospitalMembership.create({
        data: {
          hospitalId: this.hospitalId,
          userId: user.id,
          status: person.suspended ? 'SUSPENDED' : 'ACTIVE',
          dutyStatus: person.onDuty ? 'ON_DUTY' : 'OFF_DUTY',
          dutyChangedAt: offAt ?? (person.onDuty ? createdAt : null),
          createdAt,
        },
      });
      this.members.set(person.key, membership.id);
      const target = { type: 'HospitalMembership', id: membership.id };
      this.audit(createdAt, this.manager.key, 'staff.create', target, {
        userId: user.id,
        email: this.email(person),
        displayName: person.name,
      });

      for (const grant of person.roles) {
        const userRole = await this.transaction.userRole.create({
          data: {
            hospitalId: this.hospitalId,
            membershipId: membership.id,
            roleId: this.required(this.roles, grant.role, 'role'),
          },
        });
        const scope = this.scope(grant.scope);
        await this.transaction.scopeAssignment.create({
          data: { hospitalId: this.hospitalId, userRoleId: userRole.id, ...scope },
        });
        this.audit(createdAt, this.manager.key, 'role.assign', target, {
          roleId: userRole.roleId,
          ...scope,
        });
      }
      for (const code of person.departments ?? []) {
        const departmentId = this.required(this.departments, code, 'department');
        await this.transaction.staffDepartment.create({
          data: { hospitalId: this.hospitalId, membershipId: membership.id, departmentId },
        });
        this.audit(createdAt, this.manager.key, 'staff.department.add', target, { departmentId });
      }
      for (const coverage of person.coverage ?? []) {
        const scope = this.scope(coverage);
        const data =
          scope.scopeType === 'FLOOR'
            ? { scopeType: scope.scopeType, floorId: scope.scopeId }
            : scope.scopeType === 'WARD'
              ? { scopeType: scope.scopeType, wardId: scope.scopeId }
              : { scopeType: scope.scopeType };
        await this.transaction.staffLocationScope.create({
          data: { hospitalId: this.hospitalId, membershipId: membership.id, ...data },
        });
        this.audit(createdAt, this.manager.key, 'staff.coverage.add', target, data);
      }
      if (person.onDuty || person.wentOffDuty) {
        this.audit(createdAt, this.manager.key, 'staff.duty', target, {
          from: 'OFF_DUTY',
          to: 'ON_DUTY',
        });
      }
      if (person.wentOffDuty && offAt) {
        this.audit(offAt, person.wentOffDuty.by, 'staff.duty', target, {
          from: 'ON_DUTY',
          to: 'OFF_DUTY',
        });
      }
      if (person.suspended) {
        this.audit(this.at(person.suspended.at), person.suspended.by, 'staff.status', target, {
          from: 'ACTIVE',
          to: 'SUSPENDED',
          revokedSessions: 0,
        });
      }
    }
  }

  private async addStays(): Promise<void> {
    const changes = this.spec.qrChanges;
    const qrBeds = new Set([
      ...this.spec.stays.map((stay) => stay.bed),
      ...(changes?.revoked ?? []).map((change) => change.bed),
    ]);
    for (const bedCode of qrBeds) {
      const bed = this.required(this.beds, bedCode, 'bed');
      const firstStay = this.spec.stays
        .filter((stay) => stay.bed === bedCode)
        .map((stay) => this.at(stay.from).getTime())
        .sort((left, right) => left - right)[0];
      const revoked = changes?.revoked?.find((change) => change.bed === bedCode);
      const rotated = changes?.rotated?.find((change) => change.bed === bedCode);
      const issuedAt = new Date(
        (firstStay ?? this.at(revoked?.at ?? 0).getTime() - day) - 30 * minute,
      );
      const qr = await this.transaction.bedQrCode.create({
        data: {
          hospitalId: this.hospitalId,
          bedId: bed.id,
          // Only the hash of a random secret; use Replace QR to get a printable link.
          tokenHash: hashOpaqueToken(createOpaqueToken()),
          status: revoked ? 'REVOKED' : 'ACTIVE',
          version: rotated ? 2 : 1,
          issuedAt,
          rotatedAt: rotated ? this.at(rotated.at) : null,
          revokedAt: revoked ? this.at(revoked.at) : null,
          createdAt: issuedAt,
        },
      });
      const target = { type: 'BedQrCode', id: qr.id };
      this.audit(issuedAt, this.spec.qrIssuedBy, 'qr.generate', target, {
        bedId: bed.id,
        version: 1,
      });
      if (rotated) {
        this.audit(this.at(rotated.at), rotated.by, 'qr.rotate', target, {
          bedId: bed.id,
          version: 2,
        });
      }
      if (revoked) {
        this.audit(this.at(revoked.at), revoked.by, 'qr.revoke', target, {
          bedId: bed.id,
          version: 1,
          revokedGuestSessions: 0,
        });
      }
    }

    for (const stay of this.spec.stays) {
      const bed = this.required(this.beds, stay.bed, 'bed');
      const from = this.at(stay.from);
      const to = stay.to === undefined ? null : this.at(stay.to);
      const session = await this.transaction.bedSession.create({
        data: {
          hospitalId: this.hospitalId,
          bedId: bed.id,
          status: to ? 'CLOSED' : 'ACTIVE',
          startedAt: from,
          endedAt: to,
          startedByMembershipId: this.member(stay.by),
          closedByMembershipId: to ? this.member(stay.closedBy ?? stay.by) : null,
        },
      });
      // The scan that the stay's requests came from (long expired).
      const scannedAt = new Date(from.getTime() + 10 * minute);
      const expiresAt = new Date(scannedAt.getTime() + 120 * minute);
      const guest = await this.transaction.guestSession.create({
        data: {
          hospitalId: this.hospitalId,
          bedId: bed.id,
          bedSessionId: session.id,
          tokenHash: hashOpaqueToken(createOpaqueToken()),
          createdAt: scannedAt,
          lastActivityAt: scannedAt,
          expiresAt,
          revokedAt: to && to < expiresAt ? to : null,
        },
      });
      this.stays.push({ id: session.id, bed: stay.bed, from, to, guestSessionId: guest.id });
      const target = { type: 'BedSession', id: session.id };
      this.audit(from, stay.by, 'bedSession.start', target, { bedId: bed.id });
      if (to) {
        this.audit(to, stay.closedBy ?? stay.by, 'bedSession.close', target, {
          bedId: bed.id,
          revokedGuestSessions: 0,
        });
      }
    }
  }

  private covers(person: PersonSpec, bedCode: string, departmentCode: string, at: Date): boolean {
    const bed = this.required(this.beds, bedCode, 'bed');
    const unavailableFrom = [person.suspended?.at, person.wentOffDuty?.at]
      .filter((when): when is When => when !== undefined)
      .map((when) => this.at(when));
    return (
      (person.departments ?? []).includes(departmentCode) &&
      (person.coverage ?? []).some(
        (coverage) =>
          coverage === 'hospital' ||
          coverage === `floor:${bed.floorKey}` ||
          coverage === `ward:${bed.wardCode}`,
      ) &&
      unavailableFrom.every((from) => at < from)
    );
  }

  private pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.random() * items.length)];
    if (item === undefined) throw new Error('Nothing to choose from.');
    return item;
  }

  // Everyday work: most requests are handled and closed, some late, a few
  // cancelled by the patient.
  private routineRequests(): (RequestSpec & { routine: true })[] {
    const routine = this.spec.routine;
    if (!routine) return [];
    const plans: (RequestSpec & { routine: true })[] = [];
    const totalWeight = routine.services.reduce((sum, [, weight]) => sum + weight, 0);
    const chooseService = () => {
      let roll = this.random() * totalWeight;
      for (const [name, weight] of routine.services) {
        roll -= weight;
        if (roll <= 0) return name;
      }
      return routine.services[0]![0];
    };
    for (let daysAgo = routine.days; daysAgo >= 1; daysAgo -= 1) {
      const [least, most] = routine.perDay;
      const count = least + Math.floor(this.random() * (most - least + 1));
      for (let index = 0; index < count; index += 1) {
        const time = `${7 + Math.floor(this.random() * 15)}:${Math.floor(this.random() * 60)}`;
        const at = this.at([daysAgo, time]);
        const stays = this.stays.filter(
          (stay) =>
            stay.from < at && (stay.to ?? this.now).getTime() > at.getTime() + 4 * 60 * minute,
        );
        if (stays.length === 0) continue;
        const stay = this.pick(stays);
        const service = this.required(this.services, chooseService(), 'service');
        const staff = this.spec.people.filter((person) =>
          this.covers(person, stay.bed, service.departmentCode, at),
        );
        if (staff.length === 0) continue;
        const bed = this.required(this.beds, stay.bed, 'bed');
        const local = [
          ...(routine.managers.departments[service.departmentCode] ?? []),
          ...(routine.managers.wards[bed.wardCode] ?? []),
          ...(routine.managers.floors[bed.floorKey] ?? []),
        ];
        const manager =
          local.length === 0 || this.random() < 0.15
            ? this.pick(routine.managers.fallback)
            : this.pick(local);
        if (this.random() < 0.08) {
          plans.push({
            bed: stay.bed,
            service: service.name,
            at: [daysAgo, time],
            routine: true,
            steps: [
              {
                do: 'cancel',
                by: 'patient',
                after: 1 + this.random() * 8,
                reason: this.pick(patientReasons),
              },
            ],
          });
          continue;
        }
        const quick = service.acceptMinutes <= 5;
        const late = this.random() < 0.15;
        const assignAfter =
          (quick ? 0.5 + this.random() * 1.5 : 1 + this.random() * 6) +
          (late && this.random() < 0.5 ? 10 + this.random() * 20 : 0);
        const acceptAfter = 0.3 + this.random() * 1.5;
        const startAfter = 0.5 + this.random() * 3;
        const elapsed = assignAfter + acceptAfter + startAfter;
        const work =
          Math.max(1, (service.completeMinutes - elapsed) * (0.25 + this.random() * 0.6)) +
          (late ? 15 + this.random() * 40 : 0);
        plans.push({
          bed: stay.bed,
          service: service.name,
          at: [daysAgo, time],
          routine: true,
          steps: [
            { do: 'assign', by: manager, to: this.pick(staff).key, after: assignAfter },
            { do: 'accept', after: acceptAfter },
            { do: 'start', after: startAfter },
            { do: 'complete', after: work },
            {
              do: 'close',
              by: this.random() < 0.75 ? manager : this.pick(routine.managers.fallback),
              after: 5 + this.random() * 90,
            },
          ],
        });
      }
    }
    return plans;
  }

  private async addRequests(): Promise<void> {
    const requests: Prisma.ServiceRequestCreateManyInput[] = [];
    const events: Prisma.RequestEventCreateManyInput[] = [];
    const active = new Set<string>();
    const plans: (RequestSpec & { routine?: true })[] = [
      ...this.routineRequests(),
      ...this.spec.requests,
    ];

    for (const plan of plans) {
      const submittedAt = this.at(plan.at);
      const service = this.required(this.services, plan.service, 'service');
      const bed = this.required(this.beds, plan.bed, 'bed');
      const stay = this.stays.find(
        (candidate) =>
          candidate.bed === plan.bed &&
          candidate.from <= submittedAt &&
          (!candidate.to || submittedAt < candidate.to),
      );
      const fail = (problem: string) => {
        throw new Error(`Test request ${plan.service} at ${plan.bed}: ${problem}`);
      };
      if (!stay) fail('no patient is in that bed at that time.');
      const id = randomUUID();
      const rowEvents: Prisma.RequestEventCreateManyInput[] = [];
      const rowAudits: Prisma.AuditLogCreateManyInput[] = [];
      let status: RequestStatus = 'SUBMITTED';
      let assignee: string | null = null;
      let time = submittedAt.getTime();
      const times: Partial<
        Record<
          | 'assignedAt'
          | 'acceptedAt'
          | 'startedAt'
          | 'completedAt'
          | 'closedAt'
          | 'cancelledAt'
          | 'rejectedAt',
          Date
        >
      > = {};
      const event = (
        type: RequestEventType,
        previousStatus: RequestStatus | null,
        actorType: RequestActorType,
        actorId: string,
        extra: { reason?: string; metadata?: Prisma.InputJsonObject } = {},
      ) =>
        rowEvents.push({
          hospitalId: this.hospitalId,
          requestId: id,
          type,
          previousStatus,
          resultingStatus: status,
          actorType,
          actorId,
          occurredAt: new Date(time),
          reason: extra.reason ?? null,
          metadata: extra.metadata ?? {},
          requestVersion: rowEvents.length + 1,
          correlationId: randomUUID(),
        });
      event('SUBMITTED', null, 'GUEST', stay!.guestSessionId);

      for (const step of plan.steps) {
        const move = moves[step.do];
        if (!move.from.includes(status)) fail(`cannot ${step.do} a ${status} request.`);
        time += Math.round(step.after * minute);
        const at = new Date(time);
        const previous = status;
        status = move.to;
        const by = 'by' in step ? step.by : assignee;
        if (!by) fail(`${step.do} needs a person.`);
        const reason = 'reason' in step ? step.reason : undefined;
        let metadata: Prisma.InputJsonObject = {};
        if (step.do === 'assign' || step.do === 'transfer') {
          if (!this.covers(this.person(step.to), plan.bed, service.departmentCode, at)) {
            fail(`${step.to} cannot take ${service.departmentCode} work at that bed then.`);
          }
          metadata = {
            assigneeId: this.member(step.to),
            ...(step.do === 'transfer' && assignee
              ? { previousAssigneeId: this.member(assignee) }
              : {}),
          };
          assignee = step.to;
          times.assignedAt = at;
        }
        if (step.do === 'accept') times.acceptedAt ??= at;
        if (step.do === 'start') times.startedAt ??= at;
        if (step.do === 'complete') times.completedAt = at;
        if (step.do === 'close') times.closedAt = at;
        if (step.do === 'cancel') times.cancelledAt = at;
        if (step.do === 'reject') times.rejectedAt = at;

        if (by === 'patient') {
          event(move.event, previous, 'GUEST', stay!.guestSessionId, reason ? { reason } : {});
          continue;
        }
        const actorId = this.member(by!);
        event(move.event, previous, 'STAFF', actorId, {
          ...(reason ? { reason } : {}),
          metadata,
        });
        if (['assign', 'transfer', 'cancel', 'reject'].includes(step.do)) {
          rowAudits.push({
            hospitalId: this.hospitalId,
            actorType: 'STAFF',
            actorMembershipId: actorId,
            action: `request.${step.do}`,
            targetType: 'ServiceRequest',
            targetId: id,
            metadata: {
              previousStatus: previous,
              status,
              ...metadata,
              ...(reason ? { reason } : {}),
            },
            requestId: randomUUID(),
            createdAt: at,
          });
        }
      }

      const limit = Math.min(stay!.to?.getTime() ?? Infinity, this.now.getTime() - minute);
      if (time > limit) {
        if (plan.routine) continue;
        fail('its history would end after the patient left or in the future.');
      }
      if (activeStatuses.includes(status)) {
        const key = `${stay!.id}:${service.id}`;
        if (active.has(key)) fail('the same bed already has this service open.');
        active.add(key);
      }

      requests.push({
        id,
        publicId: `CR-${randomBytes(8).toString('hex').toUpperCase()}`,
        hospitalId: this.hospitalId,
        bedId: bed.id,
        bedSessionId: stay!.id,
        serviceId: service.id,
        serviceName: service.name,
        categoryName: service.categoryName,
        departmentId: service.departmentId,
        assigneeId: assignee ? this.member(assignee) : null,
        priority: service.priority,
        status,
        slaPolicyId: service.slaPolicyId,
        slaPolicyVersionId: service.slaPolicyVersionId,
        slaPolicyVersion: service.slaPolicyVersion,
        acceptMinutes: service.acceptMinutes,
        completeMinutes: service.completeMinutes,
        escalationPolicyId: service.escalationPolicyId,
        acceptDueAt: new Date(submittedAt.getTime() + service.acceptMinutes * minute),
        completeDueAt: new Date(submittedAt.getTime() + service.completeMinutes * minute),
        submittedAt,
        ...times,
        createdAt: submittedAt,
        updatedAt: new Date(time),
        version: rowEvents.length,
      });
      events.push(...rowEvents);
      this.audits.push(...rowAudits);
    }

    await this.transaction.serviceRequest.createMany({ data: requests });
    await this.transaction.requestEvent.createMany({ data: events });
  }

  private async addShifts(): Promise<void> {
    for (const shift of this.spec.shifts ?? []) {
      const startsAt = this.at(shift.from);
      await this.transaction.shift.create({
        data: {
          hospitalId: this.hospitalId,
          membershipId: this.member(shift.person),
          departmentId: this.required(this.departments, shift.department, 'department'),
          startsAt,
          endsAt: new Date(startsAt.getTime() + shift.hours * 60 * minute),
          createdByMembershipId: this.member(shift.by),
          createdAt: this.at(1),
        },
      });
    }
  }
}

export interface TestSeedInput {
  // Every staff account in the test hospitals signs in with this password.
  readonly password: string;
  // Optional: also create platform.demo@careqr.example if it does not exist.
  readonly platformPassword?: string | undefined;
  readonly now?: Date;
}

export interface TestSeedResult {
  readonly created: readonly {
    code: string;
    name: string;
    client: string;
    accounts: readonly { email: string; name: string; roles: string }[];
  }[];
  readonly skipped: readonly string[];
  readonly platformEmail: string | null;
}

/**
 * Creates the test hospitals that do not exist yet, each in one transaction.
 * An existing hospital with the same code is left untouched (skipped); a
 * login email that already belongs to someone else stops the seed.
 */
export async function seedTestHospitals(
  database: PrismaClient,
  input: TestSeedInput,
): Promise<TestSeedResult> {
  const now = input.now ?? new Date();
  if (input.platformPassword) await seedDemoPlatformAdmin(database, input.platformPassword);
  const platformUser = await database.user.findUnique({
    where: { email: demoHospital.platformEmail },
    select: { id: true, platformAdmin: { select: { userId: true } } },
  });
  const platformUserId = platformUser?.platformAdmin ? platformUser.id : null;

  const created: TestSeedResult['created'][number][] = [];
  const skipped: string[] = [];
  for (const spec of testHospitalSpecs) {
    if (await database.hospital.findUnique({ where: { code: spec.code } })) {
      skipped.push(spec.code);
      continue;
    }
    const email = (key: string) => {
      const person = spec.people.find((candidate) => candidate.key === key)!;
      return `${person.email}@${spec.domain}`;
    };
    const passwordHashes = new Map(
      await Promise.all(
        spec.people
          .slice(1)
          .map(async (person) => [person.key, await hashPassword(input.password)] as const),
      ),
    );
    const manager = spec.people[0]!;
    await bootstrapHospital(
      database,
      {
        name: spec.name,
        code: spec.code,
        timezone,
        adminEmail: email(manager.key),
        adminName: manager.name,
        adminPassword: input.password,
        client: spec.client,
      },
      async (transaction, hospital) => {
        await new HospitalSeeder(
          transaction,
          spec,
          hospital,
          now,
          platformUserId,
          passwordHashes,
        ).run();
      },
    );
    created.push({
      code: spec.code,
      name: spec.name,
      client: spec.client.name,
      accounts: spec.people.map((person) => ({
        email: email(person.key),
        name: person.name,
        roles: person.roles.map((grant) => `${grant.role} (${grant.scope})`).join(', '),
      })),
    });
  }
  return { created, skipped, platformEmail: platformUserId ? demoHospital.platformEmail : null };
}
