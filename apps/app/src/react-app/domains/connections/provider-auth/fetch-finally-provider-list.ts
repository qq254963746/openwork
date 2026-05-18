import type { ConfigProvidersResponse, ProviderListResponse } from "@aiwork-engine/sdk/v2/client";

import {
  readGlobalDisabledProviderIds,
  type ReadGlobalAiWorkEngineConfigInput,
} from "../../../../app/lib/global-engine-disabled-providers";
import { unwrap } from "../../../../app/lib/engine";
import { mergeAuthMetadataBaseUrlIntoProviderList } from "../../../../app/lib/provider-list-merge";
import type { Client } from "../../../../app/types";
import { filterProviderList, mapConfigProvidersToList } from "../../../../app/utils/providers";
import { ConsoleLog } from "../../../../app/lib/console-log";

const LOG_SCOPE = "provider-auth";

export type FetchFinallyProviderListParams = {
  listClient: Client;
  globalInput: ReadGlobalAiWorkEngineConfigInput;
  /**
   * When omitted, loads via `readGlobalDisabledProviderIds(globalInput)` (same as
   * `refreshProviders` in the provider-auth store).
   */
  disabledProviders?: string[];
  /** Passed to `config.providers({ directory })` on fallback. */
  workspaceConfigDirectory?: string | undefined;
  /** Used to reconstruct `connected` when falling back from `config.providers`. */
  providerConnectedIds: string[];
};

/**
 * Mirrors provider discovery in `refreshProviders`: `provider.list` → merge → filter disabled,
 * with `config.providers` fallback when list fails.
 */
export async function fetchFinallyProviderList(
  params: FetchFinallyProviderListParams,
): Promise<ProviderListResponse | null> {
  const { listClient, globalInput, workspaceConfigDirectory, providerConnectedIds } = params;

  let disabledProviders: string[];
  if (params.disabledProviders !== undefined) {
    disabledProviders = params.disabledProviders;
  } else {
    disabledProviders = await readGlobalDisabledProviderIds(globalInput);
    ConsoleLog.log(LOG_SCOPE, "fetchFinallyProviderList:disabledProviders from global opencode.json", {
      disabled_providers: disabledProviders,
    });
  }

  try {
    const listed = unwrap(await listClient.provider.list());
    ConsoleLog.log(LOG_SCOPE, "fetchFinallyProviderList:provider.list", listed);
    const merged = await mergeAuthMetadataBaseUrlIntoProviderList(
      listClient,
      listed,
      globalInput,
    );
    ConsoleLog.log(LOG_SCOPE, "fetchFinallyProviderList:after mergeAuthMetadataBaseUrl", {
      all: merged.all?.length,
      connected: merged.connected?.length,
      defaultCount: Object.keys(merged.default ?? {}).length,
    });
    const updated = filterProviderList(merged, disabledProviders);
    ConsoleLog.log(LOG_SCOPE, "fetchFinallyProviderList:after filterProviderList", {
      all: updated.all?.length,
      connected: updated.connected?.length,
      disabledProviders,
    });
    return updated;
  } catch {
    ConsoleLog.log(LOG_SCOPE, "fetchFinallyProviderList:provider.list failed, fallback config.providers");
    try {
      const fallback = unwrap(
        await listClient.config.providers({
          directory: workspaceConfigDirectory,
        }),
      ) as ConfigProvidersResponse;
      const mapped = mapConfigProvidersToList(fallback.providers);
      const mergedList = await mergeAuthMetadataBaseUrlIntoProviderList(
        listClient,
        {
          all: mapped,
          connected: providerConnectedIds.filter((id) => mapped.some((provider) => provider.id === id)),
          default: fallback.default,
        },
        globalInput,
      );
      const next = filterProviderList(mergedList, disabledProviders);
      ConsoleLog.log(LOG_SCOPE, "fetchFinallyProviderList:fallback applied", {
        all: next.all?.length,
        connected: next.connected?.length,
      });
      return next;
    } catch {
      ConsoleLog.log(LOG_SCOPE, "fetchFinallyProviderList:fallback failed");
      return null;
    }
  }
}
