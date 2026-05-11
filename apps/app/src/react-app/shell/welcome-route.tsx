/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../i18n";
import {
  pickDirectory,
  resolveWorkspaceListSelectedId,
  workspaceCreate,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
} from "../../app/lib/desktop";
import { useLocal } from "../kernel/local-provider";
import { WelcomePage } from "../domains/onboarding/welcome-page";
import { CreateWorkspaceModal } from "../domains/workspace/create-workspace-modal";
import { resolveAiWorkConnection } from "./aiwork-connection";
import { createAiWorkServerClient } from "../../app/lib/aiwork-server";
import { writeActiveWorkspaceId } from "./session-memory";
import { workspaceSettingsRoute } from "./workspace-routes";

function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

/**
 * WelcomeRoute: full-screen welcome page shown on first launch when
 * the user has no workspaces and has not completed onboarding.
 *
 * Clicking "Get started" opens the CreateWorkspaceModal (local folder
 * flow). Once a workspace is created, hasCompletedOnboarding is set
 * and the user is redirected to settings.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const local = useLocal();
  const [modalOpen, setModalOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // If user already completed onboarding, redirect away immediately.
  useEffect(() => {
    if (local.prefs.hasCompletedOnboarding) {
      navigate("/session", { replace: true });
    }
  }, [local.prefs.hasCompletedOnboarding, navigate]);

  const markOnboardingComplete = useCallback(() => {
    local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
  }, [local]);

  const handleCreateWorkspace = useCallback(
    async (_preset: string, folder: string | null) => {
      if (!folder) return;
      setCreateBusy(true);
      setCreateError(null);
      try {
        const workspaceName = folderNameFromPath(folder);
        const list = await workspaceCreate({
          folderPath: folder,
          name: workspaceName,
          preset: "starter",
        });
        const createdId =
          resolveWorkspaceListSelectedId(list) ||
          list.workspaces[list.workspaces.length - 1]?.id ||
          "";
        if (createdId) {
          await workspaceSetSelected(createdId).catch(() => undefined);
          await workspaceSetRuntimeActive(createdId).catch(() => undefined);
          writeActiveWorkspaceId(createdId);
        }
        // Register with the running aiwork-server if available.
        try {
          const { normalizedBaseUrl, resolvedToken, resolvedHostToken } =
            await resolveAiWorkConnection();
          if (normalizedBaseUrl && resolvedToken) {
            const aiworkClient = createAiWorkServerClient({
              baseUrl: normalizedBaseUrl,
              token: resolvedToken,
              hostToken: resolvedHostToken || undefined,
            });
            await aiworkClient
              .createLocalWorkspace({
                folderPath: folder,
                name: workspaceName,
                preset: "starter",
              })
              .catch(() => undefined);
          }
        } catch {
          // Best-effort server registration.
        }
        markOnboardingComplete();
        setModalOpen(false);
        navigate(createdId ? workspaceSettingsRoute(createdId, "general") : "/settings/general", { replace: true });
      } catch (error) {
        setCreateError(
          error instanceof Error ? error.message : "Failed to create workspace.",
        );
      } finally {
        setCreateBusy(false);
      }
    },
    [markOnboardingComplete, navigate],
  );

  return (
    <>
      <WelcomePage onGetStarted={() => setModalOpen(true)} />
      <CreateWorkspaceModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCreateError(null);
        }}
        onConfirm={handleCreateWorkspace}
        onPickFolder={() =>
          pickDirectory({ title: t("onboarding.authorize_folder") }) as Promise<
            string | null
          >
        }
        submitting={createBusy}
        localError={createError}
        localDisabled={false}
        localDisabledReason={undefined}
      />
    </>
  );
}
