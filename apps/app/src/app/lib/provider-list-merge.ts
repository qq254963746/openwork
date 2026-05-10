import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import type { Client, ProviderListItem } from "../types";

type OpencodeSdkFieldsResult<T> =
  | { data: T; error?: undefined; request: Request; response: Response }
  | { data?: undefined; error: unknown; request: Request; response: Response };

function apiAuthMetadataBaseUrlFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const meta = (payload as Record<string, unknown>).metadata;
  if (!meta || typeof meta !== "object") return "";
  const raw =
    (meta as Record<string, unknown>).baseURL ?? (meta as Record<string, unknown>).baseUrl;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

async function fetchAuthMetadataBaseUrl(client: Client, providerId: string): Promise<string> {
  const id = providerId.trim();
  if (!id) return "";
  const inner = client as unknown as {
    client: {
      get: (opts: Record<string, unknown>) => Promise<OpencodeSdkFieldsResult<unknown>>;
    };
  };
  try {
    const result = await inner.client.get({
      url: "/auth/{providerID}",
      path: { providerID: id },
      throwOnError: false,
    });
    if (result.data === undefined) return "";
    return apiAuthMetadataBaseUrlFromPayload(result.data);
  } catch {
    return "";
  }
}

/**
 * For each connected provider, read `GET /auth/{id}` and merge `metadata.baseURL` into
 * `Provider.options.baseURL` so the UI and routing use the same URL the user stored in auth metadata.
 */
export async function mergeAuthMetadataBaseUrlIntoProviderList(
  client: Client,
  list: ProviderListResponse,
): Promise<ProviderListResponse> {
  const connected = new Set(
    (list.connected ?? []).map((id: string) => id.trim().toLowerCase()).filter(Boolean),
  );
  const probeIds = list.all
    .map((p: ProviderListItem) => p.id?.trim())
    .filter((cid: string | undefined): cid is string => !!cid && connected.has(cid.toLowerCase()));

  const overlay = new Map<string, string>();
  await Promise.all(
    probeIds.map(async (id: string) => {
      const fromHttp = await fetchAuthMetadataBaseUrl(client, id);
      if (fromHttp) overlay.set(id.toLowerCase(), fromHttp);
    }),
  );

  const mergeOne = (p: ProviderListItem): ProviderListItem => {
    const id = p.id?.trim();
    if (!id) return p;
    const fromAuth = overlay.get(id.toLowerCase()) ?? "";
    if (!fromAuth) return p;
    const existingOpts =
      p.options && typeof p.options === "object"
        ? ({ ...(p.options as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    return {
      ...p,
      options: { ...existingOpts, baseURL: fromAuth },
    };
  };

  return {
    ...list,
    all: list.all.map(mergeOne),
  };
}

export async function fetchProviderAuthForEdit(
  client: Client,
  providerId: string,
): Promise<{
  name: string;
  baseUrl: string;
  apiKeyHint: string;
  presetCode: string;
}> {
  const id = providerId.trim();
  if (!id) {
    throw new Error("provider id required");
  }
  const inner = client as unknown as {
    client: {
      get: (opts: Record<string, unknown>) => Promise<OpencodeSdkFieldsResult<unknown>>;
    };
  };
  const result = await inner.client.get({
    url: "/auth/{providerID}",
    path: { providerID: id },
    throwOnError: false,
  });
  if (result.data === undefined) {
    const err = (result as { error?: { message?: string } }).error;
    throw new Error(
      typeof err === "object" && err && "message" in err && typeof err.message === "string"
        ? err.message
        : "Failed to read provider credentials",
    );
  }
  const data = result.data as {
    type?: string;
    key?: string;
    metadata?: Record<string, string | undefined>;
  };
  const meta = data.metadata ?? {};
  const name = (meta.name && String(meta.name).trim()) || id;
  const baseUrl =
    (meta.baseURL && String(meta.baseURL).trim()) ||
    (meta.baseUrl && String(meta.baseUrl).trim()) ||
    "";
  const apiKeyHint = typeof data.key === "string" && data.key.trim() ? data.key.trim() : "";
  const presetCode = (meta.code && String(meta.code).trim()) || "";
  return { name, baseUrl, apiKeyHint, presetCode };
}
