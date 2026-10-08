import { type ErrorRequestHandler } from 'express';
import { AppError } from '../common/errors/app-error.js';
import { describeValidationError } from '../common/validation-errors.js';
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
    // A 4xx is an expected answer (not found, not allowed, bad input), not a
    // fault in the API: log it in one line, without a stack trace.
    if (error.statusCode < 500) {
      request.log.info(
        { code: error.code, statusCode: error.statusCode, requestId },
        error.message,
      );
    } else {
      request.log.warn({ err: error, requestId }, 'Request failed');
    }
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    });
    return;
  }

  // Say which field is wrong and why, so the person can correct it.
  if (error instanceof ZodError) {
    const { message, fields } = describeValidationError(error);
    response.status(400).json({
      error: { code: 'VALIDATION_ERROR', message, fields, requestId },
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
        message:
          error.code === 'P2002'
            ? duplicateMessage(error.meta?.target)
            : 'The change conflicts with related records.',
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
  // Postgres reports ON DELETE RESTRICT violations as SQLSTATE 23001, which
  // Prisma does not map to a known error code. Treat it like P2003.
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes('code: "23001"')
  ) {
    response.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'The change conflicts with related records.',
        requestId,
      },
    });
    return;
  }
  // A CHECK constraint (SQLSTATE 23514) caught a value the API should have
  // rejected; treat it as invalid input rather than a server error.
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes('code: "23514"')
  ) {
    response.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request input.', requestId },
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

// Names the value that is already taken, from the unique constraint's fields.
function duplicateMessage(target: unknown): string {
  const fields = Array.isArray(target)
    ? target.filter((field): field is string => typeof field === 'string')
    : typeof target === 'string'
      ? [target]
      : [];
  if (fields.some((field) => field.includes('code'))) {
    return 'This code is already in use here. Choose a different code.';
  }
  if (fields.some((field) => field.includes('email'))) {
    return 'This email is already in use.';
  }
  if (fields.some((field) => field.includes('name'))) {
    return 'This name is already in use. Choose a different name.';
  }
  return 'A record with these values already exists.';
}
