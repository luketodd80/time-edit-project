import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { basicAuthAllows, credentialsFromAuthorization, DEFAULT_SITE_USER, sitePassword, siteUser } from "@/lib/site-auth";

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

describe("site password gate", () => {
  it("stays off when SITE_PASSWORD is unset or blank", () => {
    assert.equal(sitePassword({}), null);
    assert.equal(sitePassword({ SITE_PASSWORD: "" }), null);
    assert.equal(sitePassword({ SITE_PASSWORD: "   " }), null);
    assert.equal(basicAuthAllows(null, {}), true);
    assert.equal(basicAuthAllows(null, { SITE_PASSWORD: "" }), true);
    assert.equal(basicAuthAllows("Bearer nope", { SITE_USER: "review" }), true);
  });

  it("requires SITE_USER and a matching Basic credential when the password is set", () => {
    const env = { SITE_USER: "review", SITE_PASSWORD: "shared-secret" };
    assert.equal(sitePassword(env), "shared-secret");
    assert.equal(basicAuthAllows(null, env), false);
    assert.equal(basicAuthAllows("Bearer shared-secret", env), false);
    assert.equal(basicAuthAllows(basic("review", "wrong"), env), false);
    assert.equal(basicAuthAllows(basic("other", "shared-secret"), env), false);
    assert.equal(basicAuthAllows(basic("review", "shared-secret"), env), true);
    assert.equal(basicAuthAllows(`  ${basic("review", "shared-secret")}  `, env), true);
    assert.equal(basicAuthAllows(basic("review", "shared-secret").replace("Basic", "basic"), env), true);
  });

  it("uses servco when SITE_USER is unset or blank", () => {
    assert.equal(DEFAULT_SITE_USER, "servco");
    assert.equal(siteUser({}), "servco");
    assert.equal(siteUser({ SITE_USER: "  " }), "servco");
    assert.equal(siteUser({ SITE_USER: "review" }), "review");
    const env = { SITE_PASSWORD: "shared-secret" };
    assert.equal(basicAuthAllows(null, env), false);
    assert.equal(basicAuthAllows(basic("", "shared-secret"), env), false);
    assert.equal(basicAuthAllows(basic("review", "shared-secret"), env), false);
    assert.equal(basicAuthAllows(basic("servco", "shared-secret"), env), true);
    assert.equal(basicAuthAllows(basic("servco", "shared-secret"), { SITE_USER: "", SITE_PASSWORD: "shared-secret" }), true);
  });

  it("keeps a colon inside the password", () => {
    const env = { SITE_USER: "review", SITE_PASSWORD: "one:two" };
    assert.equal(basicAuthAllows(basic("review", "one:two"), env), true);
    assert.equal(basicAuthAllows(basic("review", "one"), env), false);
    assert.deepEqual(credentialsFromAuthorization(basic("review", "one:two")), {
      user: "review",
      password: "one:two",
    });
  });

  it("ignores a header that is not Basic credentials", () => {
    assert.equal(credentialsFromAuthorization(null), null);
    assert.equal(credentialsFromAuthorization("Basic"), null);
    assert.equal(credentialsFromAuthorization("Basic %%%"), null);
    assert.equal(credentialsFromAuthorization(`Basic ${Buffer.from("no-colon").toString("base64")}`), null);
  });
});
