export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    const message =
      typeof body.detail === "string"
        ? body.detail
        : response.status === 422
          ? "Check the form fields and try again."
          : `Request failed (${response.status}).`;
    if (response.status === 401 && path !== "/auth/login")
      window.dispatchEvent(new Event("studio:unauthorized"));
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const audioUpload = (file: File): RequestInit => {
  const body = new FormData();
  body.append("file", file);
  return { method: "POST", body };
};
