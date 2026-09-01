export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export class GeometryValidationError extends Error {
  constructor(error, reason) {
    super(error);
    this.name = 'GeometryValidationError';
    this.statusCode = 400;
    this.error = error;
    this.reason = reason;
  }
}
