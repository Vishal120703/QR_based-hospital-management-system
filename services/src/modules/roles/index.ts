// Public interface of the roles module: permissions, built-in and custom
// roles, and who holds which role where.
export { lockedRoleKey, type BuiltInRoleKey } from './built-in-roles.js';
export { type PermissionKey } from './permissions.js';
export { RoleController } from './role.controller.js';
export { createRoleRoutes } from './role.routes.js';
export {
  createBuiltInRoles,
  ensurePermissionCatalog,
  grantRole,
  RoleService,
} from './role.service.js';
