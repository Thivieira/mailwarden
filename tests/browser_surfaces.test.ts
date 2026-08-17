import { describe, expect, it } from "bun:test";

/**
 * Every surface a person can reach in a browser must render as a designed page, and every
 * surface a program reaches must stay JSON. These paths are shared - `/api/approvals/:id/review`
 * is opened by a human while the rest of `/api/*` is called by software - so the split is
 * decided by the Accept header and is easy to break silently.
 *
 * Before this existed, an expired approval link served the plain string
 * "Approval challenge not found" on a white page, mid security flow.
 */
describe("Browser-reachable surfaces carry the design system", () => {
  const html = (path: string) =>
    import("../src/http/app").then(({ app }) =>
      app.fetch(new Request(`http://localhost:3000${path}`, { headers: { Accept: "text/html" } }))
    );
  const json = (path: string) =>
    import("../src/http/app").then(({ app }) =>
      app.fetch(new Request(`http://localhost:3000${path}`, { headers: { Accept: "application/json" } }))
    );

  const designed = async (res: Response) => {
    const body = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    // The shell, the type system, and the seal - if these are present it went through renderPage.
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("site-header");
    expect(body).toContain("Mailwarden");
    expect(body).toContain("--background");
    return body;
  };

  it("an unknown path renders the designed notice, not Hono's plain text", async () => {
    const res = await html("/no-such-page");
    expect(res.status).toBe(404);
    const body = await designed(res);
    expect(body).not.toBe("404 Not Found");
    expect(body).toContain("Page not found");
  });

  it("an unknown path still answers JSON to a program", async () => {
    const res = await json("/no-such-page");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ error: "NotFound" });
  });

  it("an unknown approval link without a human session offers sign-in, not draft content", async () => {
    const res = await html("/api/approvals/does-not-exist/review");
    expect(res.status).toBe(200);
    const body = await designed(res);
    expect(body).toContain("Sign in to review this email");
    expect(body).not.toContain("Approval challenge not found");
  });

  it("the notice page never leaks an internal error message to a browser", async () => {
    const res = await html("/api/approvals/does-not-exist/review");
    const body = await res.text();
    expect(body).not.toMatch(/stack|SQLITE|D1_|drizzle|at Object\./i);
  });
});
