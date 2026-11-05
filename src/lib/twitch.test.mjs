import assert from "node:assert/strict";
import test from "node:test";
import { createTwitchLiveCheck } from "./twitch.ts";

const config = { clientId: "test-id", clientSecret: "test-secret", channel: "test_channel" };

test("live checks share requests and cache tokens and status for a minute", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let tokens = 0;
  let streams = 0;
  const check = createTwitchLiveCheck(config, async (url, options) => {
    if (url.includes("oauth2")) {
      tokens++;
      assert.equal(options.body.get("grant_type"), "client_credentials");
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }
    if (url.includes("/users?")) return Response.json({ data: [{ id: "123" }] });
    if (url.includes("/videos?")) return Response.json({ data: [] });
    streams++;
    assert.ok(url.endsWith("user_login=test_channel"));
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return Response.json({ data: streams === 1 ? [{ title: "Painting today" }] : [] });
  });
  const [first, concurrent] = await Promise.all([check(), check()]);
  assert.deepEqual(first, {
    live: true,
    title: "Painting today",
    channel: "test_channel",
    videoId: null,
  });
  assert.deepEqual(concurrent, first);
  assert.deepEqual(await check(), first);
  assert.equal(streams, 1);
  t.mock.timers.tick(60_001);
  assert.deepEqual(await check(), {
    live: false,
    title: null,
    channel: "test_channel",
    videoId: null,
  });
  assert.equal(streams, 2);
  assert.equal(tokens, 1);
});

test("expired tokens retry once; upstream failures are not reported as offline or cached", async () => {
  let tokens = 0;
  let streams = 0;
  const check = createTwitchLiveCheck(config, async (url) => {
    if (url.includes("oauth2")) {
      tokens++;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 3600 });
    }
    if (url.includes("/users?")) return Response.json({ data: [{ id: "123" }] });
    if (url.includes("/videos?")) return Response.json({ data: [] });
    streams++;
    if (streams === 1) return new Response(null, { status: 401 });
    if (streams === 2) return new Response(null, { status: 503 });
    return Response.json({ data: [] });
  });
  await assert.rejects(check(), /503/);
  assert.equal(tokens, 2);
  assert.equal((await check()).live, false);
  assert.equal(streams, 3);
});

test("offline checks embed the newest archived broadcast and retry expired VOD tokens", async () => {
  let tokens = 0;
  let videos = 0;
  const check = createTwitchLiveCheck(config, async (url) => {
    if (url.includes("oauth2")) {
      tokens++;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 3600 });
    }
    if (url.includes("/streams?")) return Response.json({ data: [] });
    if (url.includes("/users?")) {
      assert.ok(url.endsWith("login=test_channel"));
      return Response.json({ data: [{ id: "123" }] });
    }
    assert.ok(url.endsWith("videos?user_id=123&type=archive&sort=time&first=1"));
    videos++;
    if (videos === 1) return new Response(null, { status: 401 });
    return Response.json({ data: [{ id: "456", title: "Yesterday's painting" }] });
  });
  const result = await check();
  assert.deepEqual(result, {
    live: false,
    title: "Yesterday's painting",
    channel: "test_channel",
    videoId: "456",
  });
  assert.deepEqual(await check(), result);
  assert.equal(tokens, 2);
  assert.equal(videos, 2);
});

test("VOD lookup failures and malformed responses fail explicitly without caching", async () => {
  for (const [users, videos, error] of [
    [{ data: [] }, { data: [] }, /invalid users response/],
    [{ data: [{ id: "bad-id" }] }, { data: [] }, /invalid users response/],
    [{ data: [{ id: "123" }] }, { unexpected: [] }, /invalid videos response/],
    [
      { data: [{ id: "123" }] },
      { data: [{ id: "bad-id", title: "VOD" }] },
      /invalid videos response/,
    ],
    [{ data: [{ id: "123" }] }, { data: [{ id: "456" }] }, /invalid videos response/],
    [{ data: [{ id: "123" }] }, new Response(null, { status: 503 }), /503/],
  ]) {
    let requests = 0;
    const check = createTwitchLiveCheck(config, async (url) => {
      if (url.includes("oauth2")) {
        return Response.json({ access_token: "test-token", expires_in: 3600 });
      }
      if (url.includes("/streams?")) {
        requests++;
        return Response.json({ data: [] });
      }
      if (url.includes("/users?")) return Response.json(users);
      return videos instanceof Response ? videos.clone() : Response.json(videos);
    });
    await assert.rejects(check(), error);
    await assert.rejects(check(), error);
    assert.equal(requests, 2);
  }
});

test("missing config and malformed Twitch responses fail explicitly", async () => {
  assert.throws(() => createTwitchLiveCheck({ ...config, clientSecret: "" }), {
    message: "Missing Twitch environment variables: TWITCH_CLIENT_SECRET.",
  });
  assert.throws(
    () => createTwitchLiveCheck({ ...config, channel: "https://twitch.tv/test_channel" }),
    /TWITCH_CHANNEL must be a channel login/,
  );
  assert.throws(
    () => createTwitchLiveCheck({ ...config, channel: "test_channel " }),
    /TWITCH_CHANNEL must be a channel login/,
  );
  const check = createTwitchLiveCheck(config, async (url) =>
    Response.json(
      url.includes("oauth2")
        ? { access_token: "test-token", expires_in: 3600 }
        : { unexpected: [] },
    ),
  );
  await assert.rejects(check(), /invalid streams response/);
});
