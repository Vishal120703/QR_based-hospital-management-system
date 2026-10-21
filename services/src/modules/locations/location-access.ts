import { type Prisma } from '@prisma/client';
import { bedScopeWhere, type StaffContext } from '../auth/index.js';

// What a floor- or ward-level role may see: its own floors and wards, their
// rooms and beds, and the buildings around them. Hospital-wide access adds no
// filter; a permission held nowhere relevant matches nothing.
export function areaFilters(context: StaffContext, permission: string) {
  const area = bedScopeWhere(context, permission);
  if (area && 'hospitalWide' in area) {
    return { building: {}, floor: {}, ward: {} };
  }
  const floorIds = area?.floorIds ?? [];
  const wardIds = area?.wardIds ?? [];
  const floor: Prisma.FloorWhereInput = {
    OR: [{ id: { in: floorIds } }, { wards: { some: { id: { in: wardIds } } } }],
  };
  const ward: Prisma.WardWhereInput = {
    OR: [{ floorId: { in: floorIds } }, { id: { in: wardIds } }],
  };
  const building: Prisma.BuildingWhereInput = { floors: { some: floor } };
  return { building, floor, ward };
}
