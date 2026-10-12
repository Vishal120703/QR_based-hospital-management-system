import { type RequestHandler } from 'express';
import { emptySchema } from '../../common/validation.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { changePasswordSchema, loginSchema } from './auth.schemas.js';
import { type StaffAuthService } from './auth.service.js';

export class AuthController {
  public constructor(private readonly auth: StaffAuthService) {}

  public readonly login: RequestHandler = async (request, response) => {
    const result = await this.auth.login(loginSchema.parse(request.body));
    response.status(200).json({ token: result.token, expiresAt: result.expiresAt.toISOString() });
  };

  public readonly me: RequestHandler = (request, response) => {
    emptySchema.parse(request.query);
    const context = getStaffContext(request);
    response.status(200).json({
      user: context.user,
      membershipId: context.membershipId,
      tenant: context.tenant,
      mustChangePassword: context.mustChangePassword,
      // Hospital-wide permissions; scopedPermissions also lists the ones held
      // only for some floors or wards (used by request work screens).
      permissions: [...context.hospitalPermissions].sort(),
      scopedPermissions: [...context.permissions].sort(),
      scopes: context.scopes,
    });
  };

  public readonly changePassword: RequestHandler = async (request, response) => {
    const input = changePasswordSchema.parse(request.body);
    await this.auth.changePassword(getStaffContext(request), input, getRequestId(response));
    response.status(204).send();
  };

  public readonly logout: RequestHandler = async (request, response) => {
    emptySchema.parse(request.body ?? {});
    await this.auth.logout(getStaffContext(request));
    response.status(204).send();
  };
}
