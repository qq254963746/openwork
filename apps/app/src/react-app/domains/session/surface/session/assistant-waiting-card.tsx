/** @jsxImportSource react */
import { Loader2 } from "lucide-react";
import { t } from "../../../../../i18n";

export function AssistantWaitingCard() {
  return (
    <div className="-mt-10 flex justify-center py-2" role="status" aria-live="polite" aria-busy="true">
      <span className="relative inline-flex items-center justify-center">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-gray-9" strokeWidth={2} aria-hidden />
        <span className="sr-only">{t("session.assistant_reply_loading")}</span>
      </span>
    </div>
  );
}
