// Stateless engine API: each call carries the full position (spec §3).
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function post(path, body, signal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json();
}

export const engineMove = (position, elo, signal) => post("api/move", { ...position, elo }, signal);
export const analyse = (position, multipv, signal, movetimeMs = null) =>
  post("api/analyse", { ...position, multipv, ...(movetimeMs ? { movetime_ms: movetimeMs } : {}) }, signal);

export const isAbort = (error) => error?.name === "AbortError";
