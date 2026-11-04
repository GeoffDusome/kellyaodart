type TwitchConfig = {
  clientId: string;
  clientSecret: string;
  channel: string;
};

export type TwitchStatus = {
  live: boolean;
  title: string | null;
  channel: string;
};

export function createTwitchLiveCheck(config: TwitchConfig, request = fetch) {
  const missing = [
    !config.clientId && "TWITCH_CLIENT_ID",
    !config.clientSecret && "TWITCH_CLIENT_SECRET",
    !config.channel && "TWITCH_CHANNEL",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing Twitch environment variables: ${missing.join(", ")}.`);
  }
  if (!/^[a-z0-9_]+$/i.test(config.channel)) {
    throw new Error("TWITCH_CHANNEL must be a channel login, not a URL or @handle, with no spaces.");
  }

  let token: { value: string; expiresAt: number } | undefined;
  let cached: { status: TwitchStatus; expiresAt: number } | undefined;
  let pending: Promise<TwitchStatus> | undefined;

  async function accessToken() {
    if (token && token.expiresAt > Date.now()) return token.value;
    const response = await request("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Twitch authentication failed (${response.status}).`);
    const data = await response.json();
    if (typeof data.access_token !== "string" || !(data.expires_in > 60)) {
      throw new Error("Twitch returned an invalid access token response.");
    }
    token = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return token.value;
  }

  async function streams() {
    return request(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(config.channel)}`,
      {
        headers: {
          "Client-Id": config.clientId,
          Authorization: `Bearer ${await accessToken()}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
  }

  async function refresh(): Promise<TwitchStatus> {
    let response = await streams();
    if (response.status === 401) {
      token = undefined;
      response = await streams();
    }
    if (!response.ok) throw new Error(`Twitch live check failed (${response.status}).`);
    const data = await response.json();
    if (
      !Array.isArray(data.data) ||
      data.data.some((stream: { title?: unknown } | null) =>
        !stream || typeof stream.title !== "string",
      )
    ) {
      throw new Error("Twitch returned an invalid streams response.");
    }
    const status = {
      live: data.data.length > 0,
      title: data.data[0]?.title ?? null,
      channel: config.channel,
    };
    cached = { status, expiresAt: Date.now() + 60_000 };
    return status;
  }

  return async function getStatus(): Promise<TwitchStatus> {
    if (cached && cached.expiresAt > Date.now()) return cached.status;
    pending ??= refresh().finally(() => { pending = undefined; });
    return pending;
  };
}
