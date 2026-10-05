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
  public constructor() {
    super(404, 'NOT_FOUND', 'The requested resource was not found.');
  }
}

export class ServiceUnavailableError extends AppError {
  public constructor() {
    super(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.');
  }
}
