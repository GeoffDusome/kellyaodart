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
    streams++;
    assert.ok(url.endsWith("user_login=test_channel"));
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return Response.json({ data: streams === 1 ? [{ title: "Painting today" }] : [] });
  });
  const [first, concurrent] = await Promise.all([check(), check()]);
  assert.deepEqual(first, { live: true, title: "Painting today", channel: "test_channel" });
  assert.deepEqual(concurrent, first);
  assert.deepEqual(await check(), first);
  assert.equal(streams, 1);
  t.mock.timers.tick(60_001);
  assert.deepEqual(await check(), { live: false, title: null, channel: "test_channel" });
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

test("missing config and malformed Twitch responses fail explicitly", async () => {
  assert.throws(() => createTwitchLiveCheck({ ...config, clientSecret: "" }), /TWITCH_CLIENT_SECRET/);
  const check = createTwitchLiveCheck(config, async (url) =>
    Response.json(url.includes("oauth2")
      ? { access_token: "test-token", expires_in: 3600 }
      : { unexpected: [] }),
  );
  await assert.rejects(check(), /invalid streams response/);
});
