const TRANSIENT_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

function isTransientError(error) {
  if (TRANSIENT_ERROR_CODES.has(error?.code)) return true;
  const status = error?.response?.status;
  return status === 429 || (status >= 500 && status <= 599);
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function retryTransient(
  operation,
  {
    attempts = 3,
    delayMs = 1500,
    waitFn = wait,
    onRetry = () => {},
  } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransientError(error)) {
        throw error;
      }

      onRetry(error, attempt + 1, attempts);
      await waitFn(delayMs * attempt);
    }
  }
}
