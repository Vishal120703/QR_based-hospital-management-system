export class AppError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  public constructor(message = 'The requested resource was not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ServiceUnavailableError extends AppError {
  public constructor() {
    super(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.');
  }
}

export class UnauthorizedError extends AppError {
  public constructor() {
    super(401, 'UNAUTHORIZED', 'Authentication is required.');
  }
}

export class ForbiddenError extends AppError {
  public constructor() {
    super(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  }
}

export class ConflictError extends AppError {
  public constructor(message = 'The requested change conflicts with the current state.') {
    super(409, 'CONFLICT', message);
  }
}
