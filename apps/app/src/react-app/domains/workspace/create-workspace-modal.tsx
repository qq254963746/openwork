/** @jsxImportSource react */
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { X } from "lucide-react";

import { t } from "../../../i18n";
import type { WorkspacePreset } from "../../../app/types";
import { CreateWorkspaceLocalPanel } from "./create-workspace-local-panel";
import {
  modalHeaderButtonClass,
  modalHeaderClass,
  modalOverlayClass,
  modalShellClass,
  modalSubtitleClass,
  modalTitleClass,
} from "./modal-styles";
import type { CreateWorkspaceModalProps } from "./types";

export function CreateWorkspaceModal(props: CreateWorkspaceModalProps) {
  const preset = props.defaultPreset ?? "starter";
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [showProgressDetails, setShowProgressDetails] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const showClose = props.showClose ?? true;
  const isInline = props.inline ?? false;
  const submitting = props.submitting ?? false;
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

  const elapsedSeconds = useMemo(() => {
    if (!progress?.startedAt) return 0;
    return Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  }, [now, progress]);

  const modalWidthClass = "max-w-[560px]";

  const headerTitle = props.title ?? t("dashboard.create_local_workspace_title");
  const headerSubtitle =
    props.subtitle ?? t("dashboard.create_local_workspace_subtitle");

  useEffect(() => {
    if (!submitting) {
      setShowProgressDetails(false);
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [submitting]);

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
          <div className="min-w-0">
            <h3 className={modalTitleClass}>{headerTitle}</h3>
            <p className={modalSubtitleClass}>{headerSubtitle}</p>
          </div>
        </div>
        {showClose ? (
          <button
            type="button"
            onClick={props.onClose}
            disabled={submitting}
            className={modalHeaderButtonClass}
            aria-label={t("dashboard.modal_close")}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

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
    </div>
  );

  return (
    <div className={isInline ? "w-full" : modalOverlayClass}>{content}</div>
  );
}
