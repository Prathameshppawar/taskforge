/**
 * Domain error hierarchy.
 *
 * Server Actions catch these and translate them into a typed ActionResult, so
 * no raw stack trace or Prisma internals ever reach the client.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number = 400,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message, 'VALIDATION_ERROR', 422)
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} "${id}" was not found.` : `${entity} was not found.`, 'NOT_FOUND', 404)
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'You must be signed in to do that.') {
    super(message, 'UNAUTHORIZED', 401)
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 'FORBIDDEN', 403)
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409)
  }
}

export class BusinessRuleError extends DomainError {
  constructor(message: string) {
    super(message, 'BUSINESS_RULE', 400)
  }
}
