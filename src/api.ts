export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      body && !multipart ? { "Content-Type": "application/json" } : undefined,
    body:
      body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  const value = await response
    .json()
    .catch(() => ({
      error: "The server could not be reached. Please try again.",
    }));
  if (!response.ok)
    throw new ApiError(value.error || "Please try again.", response.status);
  return value as T;
}
