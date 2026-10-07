"use client";

import { useCallback, useEffect, useState } from "react";

export interface FieldProblem {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: FieldProblem[],
  ) {
    super(message);
  }
  /** The message for one form field, if the server named it. */
  field(name: string): string | undefined {
    return this.details?.find((d) => d.field === name)?.message;
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(
      0,
      "network",
      "The server did not answer. Check your connection and try again.",
    );
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const e = payload?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "error",
      e?.message ?? `The request failed (${res.status}).`,
      Array.isArray(e?.details) ? e.details : undefined,
    );
  }
  return payload as T;
}

/** Loads data for a page. Pass null as the path to wait (for example until a project is chosen). */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: path !== null,
  });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error: ApiError) => !cancelled && setState({ data: null, error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  return { ...state, reload };
}
