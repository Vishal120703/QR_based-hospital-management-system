import { type ErrorRequestHandler } from 'express';
import { AppError } from '../common/errors/app-error.js';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';

const bodyParserErrorSchema = z.object({
  type: z.enum(['entity.parse.failed', 'entity.too.large']),
});

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  void _next;
  const requestId = String(response.getHeader('x-request-id') ?? 'unknown');

  const parserError = bodyParserErrorSchema.safeParse(error);
  if (parserError.success) {
    const oversized = parserError.data.type === 'entity.too.large';
    response.status(oversized ? 413 : 400).json({
      error: {
        code: oversized ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
        message: oversized ? 'Request body is too large.' : 'Request body must be valid JSON.',
        requestId,
      },
    });
    return;
  }

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

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request input.',
        requestId,
      },
    });
    return;
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2003')
  ) {
    response.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with these values already exists.',
        requestId,
      },
    });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId,
      },
    });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    response.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'The record changed during this request. Please retry.',
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
