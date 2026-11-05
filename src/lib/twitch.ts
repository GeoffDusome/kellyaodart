type TwitchConfig = {
  clientId: string;
  clientSecret: string;
  channel: string;
};

export type TwitchStatus = {
  live: boolean;
  title: string | null;
  channel: string;
  videoId: string | null;
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
    throw new Error(
      "TWITCH_CHANNEL must be a channel login, not a URL or @handle, with no spaces.",
    );
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

  async function helix(path: string) {
    const send = async () => request(
      `https://api.twitch.tv/helix/${path}`,
      {
        headers: {
          "Client-Id": config.clientId,
          Authorization: `Bearer ${await accessToken()}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    let response = await send();
    if (response.status === 401) {
      token = undefined;
      response = await send();
    }
    if (!response.ok) throw new Error(`Twitch ${path.split("?")[0]} check failed (${response.status}).`);
    return response.json();
  }

  async function refresh(): Promise<TwitchStatus> {
    const data = await helix(`streams?user_login=${encodeURIComponent(config.channel)}`);
    if (
      !Array.isArray(data.data) ||
      data.data.some(
        (stream: { title?: unknown } | null) => !stream || typeof stream.title !== "string",
      )
    ) {
      throw new Error("Twitch returned an invalid streams response.");
    }
    const status: TwitchStatus = {
      live: data.data.length > 0,
      title: data.data[0]?.title ?? null,
      channel: config.channel,
      videoId: null,
    };
    if (!status.live) {
      const users = await helix(`users?login=${encodeURIComponent(config.channel)}`);
      if (
        !Array.isArray(users.data) ||
        users.data.length !== 1 ||
        typeof users.data[0]?.id !== "string" ||
        !/^\d+$/.test(users.data[0].id)
      ) {
        throw new Error("Twitch returned an invalid users response or the channel does not exist.");
      }
      const videos = await helix(
        `videos?user_id=${users.data[0].id}&type=archive&sort=time&first=1`,
      );
      if (
        !Array.isArray(videos.data) ||
        videos.data.some(
          (video: { id?: unknown; title?: unknown } | null) =>
            !video ||
            typeof video.id !== "string" ||
            !/^\d+$/.test(video.id) ||
            typeof video.title !== "string",
        )
      ) {
        throw new Error("Twitch returned an invalid videos response.");
      }
      status.videoId = videos.data[0]?.id ?? null;
      status.title = videos.data[0]?.title ?? null;
    }
    cached = { status, expiresAt: Date.now() + 60_000 };
    return status;
  }

  return async function getStatus(): Promise<TwitchStatus> {
    if (cached && cached.expiresAt > Date.now()) return cached.status;
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
