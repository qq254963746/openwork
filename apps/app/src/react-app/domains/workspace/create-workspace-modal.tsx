/** @jsxImportSource react */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, FolderPlus, Globe, Loader2, X } from "lucide-react";

import { t } from "../../../i18n";
import type { WorkspacePreset } from "../../../app/types";
import { CreateWorkspaceLocalPanel } from "./create-workspace-local-panel";
import {
  modalBodyClass,
  modalHeaderButtonClass,
  modalHeaderClass,
  modalOverlayClass,
  modalShellClass,
  modalSubtitleClass,
  modalTitleClass,
  pillGhostClass,
  pillPrimaryClass,
  tagClass,
} from "./modal-styles";
import { WorkspaceOptionCard } from "./option-card";
import { RemoteWorkspaceFields } from "./remote-workspace-fields";
import type {
  CreateWorkspaceModalProps,
  CreateWorkspaceScreen,
  RemoteWorkspaceInput,
} from "./types";

export function CreateWorkspaceModal(props: CreateWorkspaceModalProps) {
  const remoteUrlRef = useRef<HTMLInputElement | null>(null);

  const [screen, setScreen] = useState<CreateWorkspaceScreen>("chooser");
  const preset = props.defaultPreset ?? "starter";
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [showProgressDetails, setShowProgressDetails] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteDisplayName, setRemoteDisplayName] = useState("");
  const [remoteTokenVisible, setRemoteTokenVisible] = useState(false);

  const showClose = props.showClose ?? true;
  const isInline = props.inline ?? false;
  const submitting = props.submitting ?? false;
  const remoteSubmitting = props.remoteSubmitting ?? false;
  const workerSubmitting = props.workerSubmitting ?? false;
  const progress = props.submittingProgress ?? null;
  const workerDisabled = Boolean(props.workerDisabled);
  const workerDisabledReason = (props.workerDisabledReason ?? "").trim();
  const workerDebugLines = useMemo(
    () => (props.workerDebugLines ?? []).map((line) => line.trim()).filter(Boolean),
    [props.workerDebugLines],
  );
  const hasSelectedFolder = Boolean(selectedFolder?.trim());
  const localError = (props.localError ?? "").trim() || null;
  const remoteError = (props.remoteError ?? "").trim() || null;

  const elapsedSeconds = useMemo(() => {
    if (!progress?.startedAt) return 0;
    return Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  }, [now, progress]);

  const modalWidthClass = "max-w-[560px]";

  const headerTitle = (() => {
    switch (screen) {
      case "local":
        return t("dashboard.create_local_workspace_title");
      case "remote":
        return t("dashboard.create_remote_custom_title");
      default:
        return props.title ?? t("dashboard.create_workspace_title");
    }
  })();

  const headerSubtitle = (() => {
    switch (screen) {
      case "local":
        return t("dashboard.create_local_workspace_subtitle");
      case "remote":
        return t("dashboard.create_remote_custom_subtitle");
      default:
        return props.subtitle ?? t("dashboard.create_workspace_subtitle");
    }
  })();

  useEffect(() => {
    if (!props.open) return;
    setScreen("chooser");
    setRemoteUrl("");
    setRemoteToken("");
    setRemoteDisplayName("");
    setRemoteTokenVisible(false);
  }, [props.open]);

  useEffect(() => {
    if (!submitting) {
      setShowProgressDetails(false);
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [submitting]);

  useEffect(() => {
    if (!props.open) return;
    if (screen !== "remote") return;
    const frame = requestAnimationFrame(() => remoteUrlRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [props.open, screen]);

  const handlePickFolder = async () => {
    if (pickingFolder) return;
    setPickingFolder(true);
    try {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
      const next = await props.onPickFolder();
      if (next) setSelectedFolder(next);
    } finally {
      setPickingFolder(false);
    }
  };

  const handleRemoteSubmit = async () => {
    if (!props.onConfirmRemote) return;
    await Promise.resolve(
      props.onConfirmRemote({
        openworkHostUrl: remoteUrl.trim(),
        openworkToken: remoteToken.trim() || null,
        directory: null,
        displayName: remoteDisplayName.trim() || null,
        closeModal: true,
      }),
    );
  };

  const handleLocalSubmit = async () => {
    props.onConfirm(preset, selectedFolder);
  };

  if (!props.open && !isInline) {
    return null;
  }

  const content = (
    <div className={`${modalShellClass} ${modalWidthClass}`}>
      <div className={modalHeaderClass}>
        <div className="flex min-w-0 items-start gap-3">
          {screen !== "chooser" ? (
            <button
              type="button"
              onClick={() => setScreen("chooser")}
              disabled={submitting || remoteSubmitting}
              className={modalHeaderButtonClass}
              aria-label={t("dashboard.modal_back")}
            >
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <div className="min-w-0">
            <h3 className={modalTitleClass}>{headerTitle}</h3>
            <p className={modalSubtitleClass}>{headerSubtitle}</p>
          </div>
        </div>
        {showClose ? (
          <button
            type="button"
            onClick={props.onClose}
            disabled={submitting || remoteSubmitting}
            className={modalHeaderButtonClass}
            aria-label={t("dashboard.modal_close")}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      {screen === "chooser" ? (
        <div className={modalBodyClass}>
          <div className="space-y-3">
            <WorkspaceOptionCard
              title={t("dashboard.create_local_workspace_title")}
              description={
                props.localDisabled
                  ? props.localDisabledReason?.trim() ||
                    t("dashboard.chooser_local_desc")
                  : t("dashboard.chooser_local_desc")
              }
              icon={FolderPlus}
              onClick={() => setScreen("local")}
              disabled={props.localDisabled}
              endAdornment={
                props.localDisabled ? (
                  <span className={tagClass}>
                    {t("dashboard.desktop_badge")}
                  </span>
                ) : undefined
              }
            />
            <WorkspaceOptionCard
              title={t("dashboard.create_remote_custom_title")}
              description={t("dashboard.chooser_remote_desc")}
              icon={Globe}
              onClick={() => setScreen("remote")}
            />

            {props.onImportConfig ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => props.onImportConfig?.()}
                  disabled={props.importingConfig}
                  className={pillGhostClass}
                >
                  {props.importingConfig ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      {t("dashboard.importing")}
                    </span>
                  ) : (
                    t("dashboard.import_config")
                  )}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {screen === "local" ? (
        <CreateWorkspaceLocalPanel
          selectedFolder={selectedFolder}
          hasSelectedFolder={hasSelectedFolder}
          pickingFolder={pickingFolder}
          onPickFolder={() => void handlePickFolder()}
          submitting={submitting}
          localError={localError}
          onClose={props.onClose}
          onSubmit={() => void handleLocalSubmit()}
          confirmLabel={props.confirmLabel}
          workerLabel={props.workerLabel}
          onConfirmWorker={props.onConfirmWorker}
          preset={preset}
          workerSubmitting={workerSubmitting}
          workerDisabled={workerDisabled}
          workerDisabledReason={workerDisabledReason}
          workerCtaLabel={props.workerCtaLabel}
          workerCtaDescription={props.workerCtaDescription}
          onWorkerCta={props.onWorkerCta}
          workerRetryLabel={props.workerRetryLabel}
          onWorkerRetry={props.onWorkerRetry}
          workerDebugLines={workerDebugLines}
          progress={progress}
          elapsedSeconds={elapsedSeconds}
          showProgressDetails={showProgressDetails}
          onToggleProgressDetails={() =>
            setShowProgressDetails((prev) => !prev)
          }
        />
      ) : null}

      {screen === "remote" ? (
        <>
          <div className={modalBodyClass}>
            <RemoteWorkspaceFields
              hostUrl={remoteUrl}
              onHostUrlInput={setRemoteUrl}
              token={remoteToken}
              tokenVisible={remoteTokenVisible}
              onTokenInput={setRemoteToken}
              onToggleTokenVisible={() =>
                setRemoteTokenVisible((prev) => !prev)
              }
              displayName={remoteDisplayName}
              onDisplayNameInput={setRemoteDisplayName}
              submitting={remoteSubmitting}
              hostInputRef={remoteUrlRef}
              title={t("dashboard.remote_server_details_title")}
              description={t("dashboard.remote_server_details_hint")}
            />
          </div>
          <div className="space-y-3 border-t border-dls-border px-6 py-5">
            {remoteError ? (
              <div className="rounded-[20px] border border-red-7/20 bg-red-1/40 px-4 py-3 text-[13px] text-red-11">
                {remoteError}
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className={pillGhostClass}
                onClick={props.onClose}
                disabled={remoteSubmitting}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={pillPrimaryClass}
                disabled={!remoteUrl.trim() || remoteSubmitting}
                onClick={() => void handleRemoteSubmit()}
              >
                {remoteSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    {t("dashboard.connecting")}
                  </span>
                ) : (
                  t("dashboard.connect_remote_button")
                )}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );

  return (
    <div className={isInline ? "w-full" : modalOverlayClass}>{content}</div>
  );
}

export type { RemoteWorkspaceInput };
