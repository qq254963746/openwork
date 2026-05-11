import {
  pushPendingDeepLinks,
} from "../../app/lib/deep-link-bridge";
import { subscribeDesktopDeepLinks } from "../../app/lib/desktop";

let started = false;

export function startDeepLinkBridge(): void {
  if (typeof window === "undefined" || started) return;
  started = true;

  void (async () => {
    try {
      await subscribeDesktopDeepLinks((urls) => {
        pushPendingDeepLinks(window, urls);
      });
    } catch {
      // ignore startup failures
    }
  })();
}
