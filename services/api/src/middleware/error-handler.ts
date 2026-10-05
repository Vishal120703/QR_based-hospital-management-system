import { type ErrorRequestHandler } from 'express';
import { AppError } from '../common/errors/app-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  void _next;
  const requestId = String(response.getHeader('x-request-id') ?? 'unknown');

  if (error instanceof AppError) {
    request.log.warn({ err: error, requestId }, 'Request failed');
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    });
    return;
  }

  request.log.error({ err: error, requestId }, 'Unhandled request error');
  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
  });
};
