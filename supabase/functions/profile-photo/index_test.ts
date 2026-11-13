import { createPhotoHandler } from "./index.ts";

const profileId = "6b1aabc2-3d4e-4f50-9123-123456789abc";
const serviceRoleKey = "test-service-role";

Deno.test("rejects malformed or repeated profile ids before making requests", async () => {
  let fetchCount = 0;
  const handler = createPhotoHandler({
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey,
    fetcher: () => {
      fetchCount += 1;
      return Promise.resolve(new Response("unexpected"));
    },
  });

  const malformed = await handler(
    new Request("https://function.example/photo?profile_id=not-a-uuid"),
  );
  const repeated = await handler(
    new Request(
      `https://function.example/photo?profile_id=${profileId}&profile_id=${profileId}`,
    ),
  );

  if (malformed.status !== 400 || repeated.status !== 400 || fetchCount !== 0) {
    throw new Error(
      "Invalid profile IDs must be rejected before database access.",
    );
  }
});

Deno.test("does not fetch storage for profiles that are not approved", async () => {
  let storageRequestMade = false;
  const handler = createPhotoHandler({
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey,
    fetcher: (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/storage/")) storageRequestMade = true;
      return Promise.resolve(Response.json([]));
    },
  });

  const response = await handler(
    new Request(
      `https://function.example/photo?profile_id=${profileId}`,
    ),
  );

  if (response.status !== 404 || storageRequestMade) {
    throw new Error("Unapproved profiles must not yield storage requests.");
  }
});

Deno.test("serves only the server-stored photo path for an approved profile", async () => {
  const photoPath = `${profileId}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp`;
  const requestedUrls: URL[] = [];
  let approvedFilterUsed = false;
  let serverCredentialUsed = false;
  const handler = createPhotoHandler({
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey,
    fetcher: (input, init) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      if (url.pathname === "/rest/v1/profiles") {
        approvedFilterUsed = url.searchParams.get("status") === "eq.approved";
        const headers = new Headers(init?.headers);
        serverCredentialUsed =
          headers.get("Authorization") === `Bearer ${serviceRoleKey}`;
        return Promise.resolve(Response.json([{ photo_path: photoPath }]));
      }
      if (url.pathname === `/storage/v1/object/service-photos/${photoPath}`) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      }
      return Promise.resolve(new Response("unexpected", { status: 404 }));
    },
  });

  const response = await handler(
    new Request(
      `https://function.example/photo?profile_id=${profileId}&path=attacker/file.png`,
    ),
  );
  const storedPathRequest = requestedUrls.some((url) =>
    url.pathname === `/storage/v1/object/service-photos/${photoPath}`
  );

  if (
    response.status !== 200 ||
    response.headers.get("Content-Type") !== "image/webp" ||
    response.headers.get("Cache-Control") !== "no-store" ||
    !storedPathRequest ||
    !approvedFilterUsed ||
    !serverCredentialUsed
  ) {
    throw new Error(
      "Approved profile photos must use only the server-stored path and private caching.",
    );
  }
});

Deno.test("rejects a stored path that belongs to a different profile", async () => {
  const otherProfileId = "11111111-2222-4333-8444-555555555555";
  let storageRequestMade = false;
  const handler = createPhotoHandler({
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey,
    fetcher: (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/profiles") {
        return Promise.resolve(Response.json([{
          photo_path:
            `${otherProfileId}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg`,
        }]));
      }
      storageRequestMade = true;
      return Promise.resolve(new Response("unexpected"));
    },
  });

  const response = await handler(
    new Request(
      `https://function.example/photo?profile_id=${profileId}`,
    ),
  );

  if (response.status !== 404 || storageRequestMade) {
    throw new Error("Photo paths must be scoped to the requested profile.");
  }
});
