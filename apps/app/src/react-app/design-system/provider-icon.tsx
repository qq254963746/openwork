/** @jsxImportSource react */

import { AIWORK_CUSTOM_PROVIDER_ENTRY_KEY } from "../../app/utils/model-providers-catalog";

export type ProviderIconProps = {
  providerId?: string | null;
  /**
   * Optional provider display name. When the id is an opaque cloud id
   * (e.g. a uuid), the name is what tells us whether it's an Anthropic /
   * OpenAI / AiWork provider. Ported from dev 022b68a8 ("key cloud
   * providers by cloud id") so the icon still resolves by family.
   */
  providerName?: string | null;
  /** When set to `custom`, shows the custom-provider glyph (opaque ids). */
  providerSource?: "env" | "api" | "config" | "custom";
  className?: string;
  size?: number;
};

export function ProviderIcon(props: ProviderIconProps) {
  const size = props.size ?? 16;
  const normalizedId = props.providerId?.trim().toLowerCase() ?? "";
  const normalizedName = props.providerName?.trim().toLowerCase() ?? "";
  const customKey = AIWORK_CUSTOM_PROVIDER_ENTRY_KEY.toLowerCase();
  const isCustomProvider =
    props.providerSource === "custom" ||
    normalizedId === customKey;
  const hasProviderFamily = (family: string) =>
    normalizedId === family || normalizedName.includes(family);

  const isAnthropic = hasProviderFamily("anthropic");
  const isOpenAI = hasProviderFamily("openai");
  const isAiWork = hasProviderFamily("engine");

  const fallbackLetters = (() => {
    if (normalizedId === "openrouter") return "OR";
    if (normalizedId === "deepseek") return "DS";
    if (normalizedId === "google") return "GO";
    if (normalizedId.length >= 2) return normalizedId.substring(0, 2).toUpperCase();
    return "AI";
  })();

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-md ${
        props.className ?? ""
      }`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      {isCustomProvider ? (
        <svg
          role="img"
          viewBox="0 0 1024 1024"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          width={size}
          height={size}
        >
          <path d="M509.952 161.512727c148.945455-82.850909 300.730182-91.229091 371.479273-20.945454s62.324364 221.509818-20.526546 370.501818h-0.465454a429.335273 429.335273 0 0 1 65.163636 284.392727 168.727273 168.727273 0 0 1-44.683636 85.643637 173.754182 173.754182 0 0 1-86.109091 44.683636 435.665455 435.665455 0 0 1-285.277091-65.675636 430.731636 430.731636 0 0 1-282.530909 63.813818 172.218182 172.218182 0 0 1-86.109091-44.683637c-70.283636-69.818182-62.370909-220.206545 19.502545-368.174545-81.966545-148.48-89.786182-298.309818-19.502545-368.686546s220.625455-62.324364 369.058909 19.130182z m291.886545 440.785455a901.818182 901.818182 0 0 1-92.16 106.589091 934.027636 934.027636 0 0 1-108.916363 93.602909 586.891636 586.891636 0 0 0 58.600727 21.410909c74.938182 22.341818 127.069091 19.502545 155.508364-8.843636l-0.465455 0.884363c28.811636-28.392727 31.697455-80.523636 8.843637-155.508363a546.443636 546.443636 0 0 0-21.41091-58.135273z m-582.74909-0.465455a539.927273 539.927273 0 0 0-20.433455 55.854546c-22.295273 75.357091-19.549091 127.022545 8.797091 155.368727s80.151273 31.697455 155.508364 8.936727h-0.558546a539.927273 539.927273 0 0 0 55.854546-20.526545 967.400727 967.400727 0 0 1-199.214546-199.726546z m290.90909-332.753454a851.781818 851.781818 0 0 0-131.258181 108.404363 823.296 823.296 0 0 0-109.847273 133.12 823.854545 823.854545 0 0 0 109.847273 133.12v-0.884363a852.293818 852.293818 0 0 0 131.211636 108.357818 846.754909 846.754909 0 0 0 133.538909-109.800727 856.436364 856.436364 0 0 0 108.962909-131.258182 852.852364 852.852364 0 0 0-108.962909-131.211637 829.998545 829.998545 0 0 0-133.538909-109.847272zM503.994182 418.909091a94.347636 94.347636 0 1 1-35.84 10.705454 92.811636 92.811636 0 0 1 35.84-10.705454z m310.877091-212.340364c-28.253091-28.299636-80.151273-31.557818-155.508364-8.750545a591.592727 591.592727 0 0 0-58.600727 21.876363 933.794909 933.794909 0 0 1 108.869818 93.556364 947.060364 947.060364 0 0 1 92.718545 107.054546 545.326545 545.326545 0 0 0 21.41091-58.181819q33.559273-113.058909-8.843637-155.508363zM363.054545 199.68c-74.938182-22.295273-127.069091-19.549091-155.508363 8.843636v-0.465454c-28.997818 28.392727-31.744 80.523636-8.936727 155.508363a507.345455 507.345455 0 0 0 20.433454 56.273455A976.663273 976.663273 0 0 1 418.909091 220.206545a541.230545 541.230545 0 0 0-55.854546-20.526545z m0 0" />
        </svg>
      ) : isOpenAI ? (
        <svg
          role="img"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          width={size}
          height={size}
        >
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
        </svg>
      ) : isAnthropic ? (
        <svg
          role="img"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          width={size}
          height={size}
        >
          <path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.369-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223 2.291-5.946 2.291 5.946Z" />
        </svg>
      ) : isAiWork ? (
        <svg
          role="img"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={size}
          height={size}
        >
          <path d="M12 2L2 7l10 5 10-5-10-5Z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded bg-gray-3 text-[10px] font-bold tracking-tight text-gray-11"
          style={{ fontSize: `${Math.max(8, size * 0.45)}px` }}
        >
          {fallbackLetters}
        </div>
      )}
    </div>
  );
}
