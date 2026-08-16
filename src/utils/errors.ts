export abstract class MailwardenError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
    };
  }
}

export class AuthenticationError extends MailwardenError {
  readonly code = "UNAUTHENTICATED";
  readonly statusCode = 401;
  constructor(message = "Authentication required or session invalid") {
    super(message);
  }
}

export class AuthorizationError extends MailwardenError {
  readonly code = "FORBIDDEN";
  readonly statusCode = 403;
  constructor(message = "Permission denied: missing required scope", public readonly requiredScopes?: string[]) {
    super(message);
  }
}

export class TenantIsolationError extends MailwardenError {
  readonly code = "TENANT_ACCESS_DENIED";
  readonly statusCode = 403;
  constructor(message = "Cross-tenant access violation: resource does not belong to authenticated tenant") {
    super(message);
  }
}

export class AccountOwnershipError extends MailwardenError {
  readonly code = "ACCOUNT_OWNERSHIP_DENIED";
  readonly statusCode = 403;
  constructor(message = "Account ownership violation: account does not belong to authenticated user") {
    super(message);
  }
}

export class NotFoundError extends MailwardenError {
  readonly code = "NOT_FOUND";
  readonly statusCode = 404;
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with ID '${id}' was not found` : `${resource} not found`);
  }
}

export class ConfigurationError extends MailwardenError {
  readonly code = "CONFIGURATION_ERROR";
  readonly statusCode = 500;
  constructor(message = "Invalid service or provider configuration") {
    super(message);
  }
}

export class ValidationError extends MailwardenError {
  readonly code = "VALIDATION_ERROR";
  readonly statusCode = 400;
  constructor(message: string, public readonly details?: any) {
    super(message);
  }
}

export class SendApprovalMissingError extends MailwardenError {
  readonly code = "SEND_APPROVAL_MISSING";
  readonly statusCode = 400;
  constructor(message = "Cannot send email: explicit user approval is required before sending") {
    super(message);
  }
}

export class SendApprovalNotConfirmedError extends MailwardenError {
  readonly code = "SEND_APPROVAL_NOT_CONFIRMED";
  readonly statusCode = 403;
  constructor(message = "Draft approval is pending human confirmation. A human user must confirm the exact payload before dispatch.") {
    super(message);
  }
}

export class SendApprovalInvalidError extends MailwardenError {
  readonly code = "SEND_APPROVAL_HASH_MISMATCH";
  readonly statusCode = 400;
  constructor(message = "Draft content changed after confirmation. Payload hash mismatch - new approval required") {
    super(message);
  }
}

export class SendApprovalExpiredError extends MailwardenError {
  readonly code = "SEND_APPROVAL_EXPIRED";
  readonly statusCode = 400;
  constructor(message = "Send approval has expired. A fresh approval is required") {
    super(message);
  }
}

export class SendApprovalAlreadyUsedError extends MailwardenError {
  readonly code = "SEND_APPROVAL_ALREADY_USED";
  readonly statusCode = 409;
  constructor(message = "This send approval has already been used to dispatch an email") {
    super(message);
  }
}

export class DuplicateSendError extends MailwardenError {
  readonly code = "DUPLICATE_SEND_PREVENTED";
  readonly statusCode = 409;
  constructor(message = "Duplicate send attempt prevented by idempotency lock", public readonly sendResult?: any) {
    super(message);
  }
}

export class ProviderError extends MailwardenError {
  readonly code = "PROVIDER_ERROR";
  readonly statusCode = 502;
  constructor(
    message: string,
    public readonly provider: string,
    public readonly isTransient: boolean = false,
    public readonly originalError?: any
  ) {
    super(`[${provider}] ${message}`);
  }
}

export class PromptInjectionAttemptDetected extends MailwardenError {
  readonly code = "PROMPT_INJECTION_CONTAINED";
  readonly statusCode = 400;
  constructor(message = "Adversarial content detected in email payload and contained safely") {
    super(message);
  }
}
