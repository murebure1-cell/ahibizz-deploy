import assert from "node:assert/strict";
import test from "node:test";
import { readGoogleConfiguration } from "../src/server/auth/config";
import { oauthCallbackProvider } from "../src/server/auth/service";

const clientId = "123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com";
const clientSecret = "GOCSPX-fixture_secret_value";

test("Google sign-in turns on only for a complete, well-formed client pair", () => {
  assert.deepEqual(
    readGoogleConfiguration({
      GOOGLE_CLIENT_ID: ` ${clientId} `,
      GOOGLE_CLIENT_SECRET: clientSecret,
    }),
    { clientId, clientSecret },
  );
  for (const env of [
    {},
    { GOOGLE_CLIENT_ID: clientId },
    { GOOGLE_CLIENT_SECRET: clientSecret },
    { GOOGLE_CLIENT_ID: "not-a-client-id", GOOGLE_CLIENT_SECRET: clientSecret },
    { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: "short" },
    { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: "has a space inside it" },
    { GOOGLE_CLIENT_ID: `${clientId}.evil.invalid`, GOOGLE_CLIENT_SECRET: clientSecret },
  ])
    assert.equal(readGoogleConfiguration(env), null, JSON.stringify(Object.keys(env)));
});

test("only a Google callback may keep Google's email confirmation", () => {
  assert.equal(
    oauthCallbackProvider({ path: "/callback/:id", params: { id: "google" } }),
    "google",
  );
  assert.equal(oauthCallbackProvider({ path: "/callback/google" }), "google");
  assert.equal(oauthCallbackProvider({ path: "/callback/:id" }), null);
  assert.equal(oauthCallbackProvider({ path: "/sign-up/email" }), null);
  assert.equal(oauthCallbackProvider(null), null);
});
