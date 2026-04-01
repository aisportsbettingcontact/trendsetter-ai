import { ENV } from "../../_core/env";

type ForgeConfig = {
  baseUrl: string;
  apiKey: string;
};

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

export function getForgeConfig(): ForgeConfig {
  const baseUrl = trimTrailingSlashes(ENV.forgeApiUrl);
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Forge integration is not configured. Set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY."
    );
  }

  return { baseUrl, apiKey };
}

export function getOptionalForgeConfig(): ForgeConfig | null {
  try {
    return getForgeConfig();
  } catch {
    return null;
  }
}

export function buildForgeUrl(pathname: string): string {
  const { baseUrl } = getForgeConfig();
  const normalizedPath = pathname.replace(/^\/+/, "");
  return new URL(normalizedPath, `${baseUrl}/`).toString();
}

export function buildForgeAuthHeaders(
  extras: HeadersInit = {}
): HeadersInit {
  const { apiKey } = getForgeConfig();
  return {
    authorization: `Bearer ${apiKey}`,
    ...extras,
  };
}
