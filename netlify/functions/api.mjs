// a-tom. Production Pipeline — API (Netlify Function → Neon Postgres)
import { neon } from "@neondatabase/serverless";
import { getStore } from "@netlify/blobs";
import { ensureSchema } from "./_schema.mjs";

const sql = neon(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const split = (p) => { const i = p.lastIndexOf("/"); return { col: p.slice(0, i), id: p.slice(i + 1) }; };
const okPath = (p) => typeof p === "string" && p.length < 300 && p.includes("/") && !p.startsWith("/") && !p.endsWith("/");
const okField = (k) => typeof k === "string" && /^[A-Za-z0-9_]{1,64}$/.test(k);


// ---------- auth: email sign-up / sign-in with a magic link ----------
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === "true";
const APPROVERS = (process.env.APPROVER_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const FROM = process.env.MAIL_FROM;
const COOKIE = "pp_sess";
const enc = new TextEncoder();
const rand = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const cookieOf = (req) => { const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)pp_sess=([a-f0-9]+)/); return m ? m[1] : ""; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "member";
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function sessionOf(req) {
  const t = cookieOf(req); if (!t) return null;
  const r = await sql.query("select email from sessions where token_hash = $1 and expires_at > now()", [await sha(t)]);
  return r[0] ? { email: r[0].email } : null;
}
function setCookie(token, maxAge) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }

async function auth(req, url, route) {
  if (req.method === "POST" && route === "/auth/start") {
    const { email: raw, name: rawName, mode } = await req.json();
    const email = String(raw || "").trim().toLowerCase(), name = String(rawName || "").trim().slice(0, 60);
    if (!validEmail(email)) return json({ error: "Enter a valid email." }, 400);
    if (DOMAINS.length && !DOMAINS.includes(email.split("@")[1])) return json({ error: "Use your work email (" + DOMAINS.join(", ") + ")." }, 403);
    const known = await sql.query("select 1 from docs where col = 'team' and lower(data->>'email') = $1 limit 1", [email]);
    const token = rand();
    await sql.query("insert into auth_tokens (token_hash, email, name, expires_at) values ($1, $2, $3, now() + interval '30 minutes')", [await sha(token), email, name]);
    const link = `${url.origin}/api/auth/verify?t=${token}`;
    if (!FROM || !process.env.RESEND_API_KEY) return json({ error: "Email isn't set up yet. Add MAIL_FROM and RESEND_API_KEY in Netlify." }, 500);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: email, subject: "Your a-tom. Pipeline sign-in link",
        text: `Tap to sign in to the a-tom. Production Pipeline:\n\n${link}\n\nThis link works once and expires in 30 minutes.`,
        html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0B1426"><p style="font-size:13px;color:#5B6478">a-tom. Production Pipeline</p><h2 style="font-size:20px;margin:0 0 16px">Sign in</h2><a href="${link}" style="display:inline-block;background:#2447F0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Sign in</a><p style="font-size:13px;color:#5B6478;margin-top:20px">The link works once and expires in 30 minutes. If you didn't ask for it, ignore this email.</p></div>` }),
    });
    if (!res.ok) return json({ error: "Couldn't send the email. " + (await res.text()).slice(0, 160) }, 502);
    return json({ ok: true, isNew: !known.length });
  }
  if (req.method === "GET" && route === "/auth/verify") {
    const t = url.searchParams.get("t") || "";
    const r = await sql.query("delete from auth_tokens where token_hash = $1 and expires_at > now() returning email, name", [await sha(t)]);
    if (!r[0]) return new Response(null, { status: 302, headers: { Location: "/?login=expired" } });
    const { email, name } = r[0];
    const ex = await sql.query("select path from docs where col = 'team' and lower(data->>'email') = $1 limit 1", [email]);
    if (ex[0]) await sql.query("update docs set data = jsonb_merge_deep(data, $2::jsonb), updated_at = now() where path = $1", [ex[0].path, JSON.stringify({ userId: "em:" + email })]);
    else {
      let id = slug(name || email.split("@")[0]);
      const clash = await sql.query("select 1 from docs where path = $1", ["team/" + id]); if (clash.length) id += "-" + rand().slice(0, 4);
      const ord = await sql.query("select coalesce(max((data->>'order')::int), -1) + 1 as n from docs where col = 'team'");
      await sql.query("insert into docs (path, col, id, data) values ($1, 'team', $2, $3::jsonb)", ["team/" + id, id, JSON.stringify({ id, name: name || email.split("@")[0], role: "", email, userId: "em:" + email, order: ord[0].n })]);
    }
    const token = rand();
    await sql.query("insert into sessions (token_hash, email, expires_at) values ($1, $2, now() + interval '365 days')", [await sha(token), email]);
    return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": setCookie(token, 31536000) } });
  }
  if (req.method === "GET" && route === "/auth/me") {
    const s = await sessionOf(req);
    if (!s) return json({ signedIn: false, required: REQUIRE_LOGIN });
    return json({ signedIn: true, required: REQUIRE_LOGIN, email: s.email, id: "em:" + s.email, isOwner: APPROVERS.includes(s.email) });
  }
  if (req.method === "POST" && route === "/auth/logout") {
    const t = cookieOf(req); if (t) await sql.query("delete from sessions where token_hash = $1", [await sha(t)]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": setCookie("", 0) } });
  }
  return null;
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api/, "") || "/";
  try {
    await ensureSchema(sql);
    if (route.startsWith("/auth/")) { const r = await auth(req, url, route); if (r) return r; }
    if (REQUIRE_LOGIN && !(await sessionOf(req))) return json({ error: "Sign in required" }, 401);
    if (req.method === "GET" && route === "/changes") {
      const since = Number(url.searchParams.get("since") || 0);
      const rows = await sql.query("select col, v from col_versions where v > $1", [since]);
      const top = await sql.query("select coalesce(max(v),0)::bigint as v from col_versions");
      return json({ v: Number(top[0].v), cols: rows.map((r) => r.col) });
    }
    if (req.method === "POST" && route === "/query") {
      const { col, filters = [], order, limit } = await req.json();
      if (typeof col !== "string") return json({ error: "bad col" }, 400);
      const params = [col]; let q = "select id, data from docs where col = $1";
      for (const [k, v] of filters) { if (!okField(k)) return json({ error: "bad field" }, 400); params.push(k, String(v)); q += ` and data->>$${params.length - 1} = $${params.length}`; }
      if (order && okField(order[0])) { params.push(order[0]); q += ` order by data->$${params.length} ${order[1] === "desc" ? "desc" : "asc"}`; }
      if (limit) { params.push(Math.min(Number(limit) || 0, 1000)); q += ` limit $${params.length}`; }
      return json({ rows: await sql.query(q, params) });
    }
    if (req.method === "POST" && route === "/set") {
      const { path, data } = await req.json(); if (!okPath(path)) return json({ error: "bad path" }, 400);
      const { col, id } = split(path);
      await sql.query("insert into docs (path, col, id, data, updated_at) values ($1,$2,$3,$4::jsonb, now()) on conflict (path) do update set data = excluded.data, updated_at = now()", [path, col, id, JSON.stringify(data ?? {})]);
      return json({ ok: true });
    }
    if (req.method === "POST" && route === "/update") {
      const { path, patch } = await req.json(); if (!okPath(path)) return json({ error: "bad path" }, 400);
      const r = await sql.query("update docs set data = jsonb_merge_deep(data, $2::jsonb), updated_at = now() where path = $1 returning path", [path, JSON.stringify(patch ?? {})]);
      return json({ found: r.length > 0 });
    }
    if (req.method === "POST" && route === "/delete") {
      const { path } = await req.json(); if (!okPath(path)) return json({ error: "bad path" }, 400);
      await sql.query("delete from docs where path = $1", [path]);
      return json({ ok: true });
    }
    if (req.method === "POST" && route === "/upload") {
      const name = decodeURIComponent(req.headers.get("x-file-name") || "file").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
      const type = req.headers.get("content-type") || "application/octet-stream";
      const key = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6) + "-" + name;
      await getStore("pipeline-files").set(key, await req.arrayBuffer(), { metadata: { type, name } });
      return json({ id: key });
    }
    if (route.startsWith("/file/")) {
      const key = decodeURIComponent(route.slice(6)), store = getStore("pipeline-files");
      if (req.method === "DELETE") { await store.delete(key); return json({ ok: true }); }
      const r = await store.getWithMetadata(key, { type: "arrayBuffer" });
      if (!r) return new Response("Not found", { status: 404 });
      return new Response(r.data, { headers: { "Content-Type": r.metadata?.type || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "Content-Disposition": `inline; filename="${r.metadata?.name || key}"` } });
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 500);
  }
};

export const config = { path: "/api/*" };
