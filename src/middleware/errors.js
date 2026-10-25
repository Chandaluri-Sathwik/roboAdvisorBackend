export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.code === 11000) {
    return res.status(409).json({ detail: "A record with these details already exists." });
  }

  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({ detail: "The request contains invalid data." });
  }

  const status = Number.isInteger(error.status)
    ? error.status
    : Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;
  if (status >= 500) {
    if (error instanceof HttpError) {
      console.warn(`API request failed (${status}): ${error.message}`);
    } else {
      console.error("API request failed:", error);
    }
  }

  return res.status(status).json({
    detail: error instanceof HttpError
      ? error.message
      : status >= 500
        ? "The server could not complete this request."
        : error.message,
  });
}
