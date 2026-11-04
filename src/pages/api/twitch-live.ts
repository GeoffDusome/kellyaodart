import type { APIRoute } from "astro";
import { getSecret } from "astro:env/server";
import { createTwitchLiveCheck } from "../../lib/twitch";

export const prerender = false;

let getStatus: ReturnType<typeof createTwitchLiveCheck> | undefined;

export const GET: APIRoute = async () => {
  try {
    getStatus ??= createTwitchLiveCheck({
      clientId: getSecret("TWITCH_CLIENT_ID") ?? "",
      clientSecret: getSecret("TWITCH_CLIENT_SECRET") ?? "",
      channel: getSecret("TWITCH_CHANNEL") ?? "",
    });
    return Response.json(await getStatus(), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60" },
    });
  } catch (error) {
    console.error("[twitch-live]", error instanceof Error ? error.message : "Live check failed.");
    return Response.json(
      { error: "Unable to check Twitch live status. Please try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};
