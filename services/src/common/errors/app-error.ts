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

export class TooManyRequestsError extends AppError {
  public constructor() {
    super(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
  }
}

// Input that is well-formed but violates a rule checked against stored data.
export class InvalidInputError extends AppError {
  public constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message);
  }
}
