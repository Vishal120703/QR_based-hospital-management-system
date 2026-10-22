// Who is signed in, and what they may do where. Built once per request by
// StaffAuthService.authenticate; every module checks access with these helpers.

export interface AuthorizationScope {
  readonly type: 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT';
  readonly id: string;
}

export interface StaffContext {
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly tenant: {
    readonly hospitalId: string;
    readonly code: string;
    readonly name: string;
    readonly logoUrl: string | null;
    // IANA time zone; report days and "today" follow it.
    readonly timezone: string;
    // Off: patients use bedside QR codes without being admitted.
    readonly bedOccupancyEnabled: boolean;
    // Settings paused new patient requests (staff screens say so).
    readonly patientRequestsPaused: boolean;
  };
  readonly membershipId: string;
  readonly sessionId: string;
  // An administrator reset the password: only changing it is allowed.
  readonly mustChangePassword: boolean;
  // The roles held (any scope), for escalations sent to a role.
  readonly roleIds: readonly string[];
  // Every permission held in at least one scope. Only location-aware code
  // (requests, eligibility) may rely on this, together with scopesFor().
  readonly permissions: ReadonlySet<string>;
  // Permissions held hospital-wide. Plain route guards check this set, so a
  // floor- or ward-scoped role never unlocks hospital-wide screens.
  readonly hospitalPermissions: ReadonlySet<string>;
  readonly permissionScopes: ReadonlyMap<string, ReadonlyArray<AuthorizationScope>>;
  readonly scopes: ReadonlyArray<AuthorizationScope>;
}

// The scopes in which the staff member holds one permission.
export function scopesFor(
  context: Pick<StaffContext, 'permissionScopes'>,
  permission: string,
): ReadonlyArray<AuthorizationScope> {
  return context.permissionScopes.get(permission) ?? [];
}

// Whether the permission covers a target: a bed in this ward and floor, and
// for requests also the department that handles it.
export function canAccessLocation(
  context: Pick<StaffContext, 'permissionScopes'> & {
    tenant: Pick<StaffContext['tenant'], 'hospitalId'>;
  },
  permission: string,
  target: {
    readonly wardId: string;
    readonly floorId: string;
    readonly departmentId?: string | undefined;
  },
): boolean {
  return scopesFor(context, permission).some(
    (scope) =>
      (scope.type === 'HOSPITAL' && scope.id === context.tenant.hospitalId) ||
      (scope.type === 'FLOOR' && scope.id === target.floorId) ||
      (scope.type === 'WARD' && scope.id === target.wardId) ||
      (scope.type === 'DEPARTMENT' && scope.id === target.departmentId),
  );
}

// Prisma filters for "beds this permission covers"; null means none at all.
// Department scopes never cover beds or locations.
export function bedScopeWhere(
  context: StaffContext,
  permission: string,
): { hospitalWide: true } | { wardIds: string[]; floorIds: string[] } | null {
  const scopes = scopesFor(context, permission);
  if (scopes.some((scope) => scope.type === 'HOSPITAL' && scope.id === context.tenant.hospitalId)) {
    return { hospitalWide: true };
  }
  const wardIds = scopes.filter((scope) => scope.type === 'WARD').map((scope) => scope.id);
  const floorIds = scopes.filter((scope) => scope.type === 'FLOOR').map((scope) => scope.id);
  return wardIds.length + floorIds.length > 0 ? { wardIds, floorIds } : null;
}
