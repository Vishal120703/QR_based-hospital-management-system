import { type Prisma } from '@prisma/client';
import { scopesFor, type StaffContext } from '../auth/auth.service.js';

// The requests one permission covers: the whole hospital ({}), the beds on the
// caller's floors and wards, or the requests of their departments. null means
// the permission covers nothing.
export function requestAreaWhere(
  context: StaffContext,
  permission: string,
): Prisma.ServiceRequestWhereInput | null {
  const scopes = scopesFor(context, permission);
  if (scopes.some((scope) => scope.type === 'HOSPITAL' && scope.id === context.tenant.hospitalId)) {
    return {};
  }
  const ids = (type: string) =>
    scopes.filter((scope) => scope.type === type).map((scope) => scope.id);
  const floorIds = ids('FLOOR');
  const wardIds = ids('WARD');
  const departmentIds = ids('DEPARTMENT');
  const any: Prisma.ServiceRequestWhereInput[] = [
    ...(floorIds.length > 0 ? [{ bed: { ward: { floorId: { in: floorIds } } } }] : []),
    ...(wardIds.length > 0 ? [{ bed: { wardId: { in: wardIds } } }] : []),
    ...(departmentIds.length > 0 ? [{ departmentId: { in: departmentIds } }] : []),
  ];
  return any.length > 0 ? { OR: any } : null;
}

// What a staff member may read: requests in their read area that they either
// manage (assign permission there) or are assigned to. Care staff therefore see
// only their own work, by list and by direct link alike.
export function visibleRequestsWhere(
  context: StaffContext,
): Prisma.ServiceRequestWhereInput | null {
  const read = requestAreaWhere(context, 'request.read');
  if (!read) return null;
  const manage = requestAreaWhere(context, 'request.assign');
  // Prisma treats an empty {} inside OR as matching nothing, so hospital-wide
  // ("everything") conditions are left out instead of nested.
  const everything = (where: Prisma.ServiceRequestWhereInput | null) =>
    where !== null && Object.keys(where).length === 0;
  const conditions: Prisma.ServiceRequestWhereInput[] = [
    ...(everything(read) ? [] : [read]),
    ...(everything(manage)
      ? []
      : [{ OR: [...(manage ? [manage] : []), { assigneeId: context.membershipId }] }]),
  ];
  return {
    hospitalId: context.tenant.hospitalId,
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  };
}
