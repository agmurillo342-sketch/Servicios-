const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

interface PhotoHandlerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
}

interface SecretKeyPhotoHandlerConfig {
  supabaseUrl: string;
  secretKeys: string | undefined;
  fetcher?: typeof fetch;
}

function responseHeaders(contentType = "text/plain; charset=utf-8"): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: responseHeaders() });
}

export function getDefaultSecretKey(
  secretKeys: string | undefined,
): string | null {
  if (!secretKeys) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(secretKeys);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("default" in parsed)
  ) {
    return null;
  }

  const defaultKey = parsed.default;
  return typeof defaultKey === "string" && defaultKey.trim() !== ""
    ? defaultKey
    : null;
}

export function createPhotoHandler(
  config: PhotoHandlerConfig,
): (request: Request) => Promise<Response> {
  const fetcher = config.fetcher ?? fetch;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return errorResponse(405, "Method not allowed");
    }

    const requestUrl = new URL(request.url);
    const profileIds = requestUrl.searchParams.getAll("profile_id");
    if (profileIds.length !== 1 || !PROFILE_ID_PATTERN.test(profileIds[0])) {
      return errorResponse(400, "Invalid profile id");
    }

    const profileId = profileIds[0].toLowerCase();
    const authorizationHeaders = {
      apikey: config.serviceRoleKey,
    };
    const profileUrl = new URL("/rest/v1/profiles", config.supabaseUrl);
    profileUrl.searchParams.set("id", `eq.${profileId}`);
    profileUrl.searchParams.set("status", "eq.approved");
    profileUrl.searchParams.set("select", "photo_path");
    profileUrl.searchParams.set("limit", "1");

    let profileResponse: Response;
    try {
      profileResponse = await fetcher(profileUrl, {
        headers: authorizationHeaders,
      });
    } catch (error) {
      console.error("Profile photo lookup failed:", error);
      return errorResponse(502, "Photo service temporarily unavailable");
    }
    if (!profileResponse.ok) {
      console.error(
        "Profile photo lookup returned status:",
        profileResponse.status,
      );
      return errorResponse(502, "Photo service temporarily unavailable");
    }

    const profiles = await profileResponse.json();
    const photoPath = Array.isArray(profiles) && profiles.length === 1
      ? profiles[0]?.photo_path
      : null;
    if (typeof photoPath !== "string") {
      return errorResponse(404, "Photo not found");
    }

    const pathSegments = photoPath.split("/");
    if (
      pathSegments.length !== 2 ||
      pathSegments[0] !== profileId ||
      !PHOTO_FILE_PATTERN.test(pathSegments[1])
    ) {
      console.error("Profile has an invalid photo path:", profileId);
      return errorResponse(404, "Photo not found");
    }

    const storageUrl = new URL(
      `/storage/v1/object/service-photos/${
        pathSegments.map(encodeURIComponent).join("/")
      }`,
      config.supabaseUrl,
    );
    let photoResponse: Response;
    try {
      photoResponse = await fetcher(storageUrl, {
        headers: authorizationHeaders,
      });
    } catch (error) {
      console.error("Profile photo download failed:", error);
      return errorResponse(502, "Photo service temporarily unavailable");
    }
    if (!photoResponse.ok || !photoResponse.body) {
      console.error(
        "Profile photo download returned status:",
        photoResponse.status,
      );
      return errorResponse(404, "Photo not found");
    }

    const extension = pathSegments[1].split(".").pop()?.toLowerCase() || "";
    return new Response(photoResponse.body, {
      status: 200,
      headers: responseHeaders(CONTENT_TYPES[extension]),
    });
  };
}

export function createPhotoHandlerFromSecretKeys(
  config: SecretKeyPhotoHandlerConfig,
): (request: Request) => Promise<Response> {
  const serviceRoleKey = getDefaultSecretKey(config.secretKeys);
  if (!serviceRoleKey) {
    console.error("SUPABASE_SECRET_KEYS is missing or invalid.");
    return () =>
      Promise.resolve(
        errorResponse(500, "Photo service configuration error"),
      );
  }

  return createPhotoHandler({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey,
    fetcher: config.fetcher,
  });
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required.");
  }

  Deno.serve(createPhotoHandlerFromSecretKeys({
    supabaseUrl,
    secretKeys: Deno.env.get("SUPABASE_SECRET_KEYS"),
  }));
}
