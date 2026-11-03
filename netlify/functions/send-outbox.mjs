// Sends queued emails from the outbox every minute (Netlify scheduled function).
import { neon } from "@neondatabase/serverless";
import { ensureSchema } from "./_schema.mjs";
const sql = neon(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL);
const FROM = process.env.MAIL_FROM;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const html = (m) => `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1426">
<p style="font-size:13px;color:#5B6478;margin:0 0 16px">a-tom. Production Pipeline</p>
<h2 style="font-size:20px;margin:0 0 14px;line-height:1.3">${esc(m.subject).replace(/^a-tom\. /, "")}</h2>
<p style="font-size:15px;line-height:1.55;margin:0 0 22px">${esc(m.text || "").replace(/Open it: \S+/, "").trim().replace(/\n/g, "<br>")}</p>
${m.link ? `<a href="${esc(m.link)}" style="display:inline-block;background:#2447F0;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px">Open in the pipeline</a>` : ""}</div>`;

export default async () => {
  if (!FROM || !process.env.RESEND_API_KEY) { console.log("MAIL_FROM / RESEND_API_KEY not set"); return new Response("not configured"); }
  await ensureSchema(sql);
  const rows = await sql.query("select path, data from docs where col = 'outbox' and data->>'status' = 'queued' order by updated_at limit 50");
  let sent = 0, failed = 0;
  for (const r of rows) {
    const m = r.data;
    if (!m.to) { await sql.query("update docs set data = jsonb_merge_deep(data, $2::jsonb), updated_at = now() where path = $1", [r.path, JSON.stringify({ status: "no_email" })]); continue; }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: m.to, subject: m.subject, text: m.text, html: html(m) }),
    });
    const error = res.ok ? null : (await res.text()).slice(0, 300);
    res.ok ? sent++ : failed++;
    await sql.query("update docs set data = jsonb_merge_deep(data, $2::jsonb), updated_at = now() where path = $1", [r.path, JSON.stringify({ status: res.ok ? "sent" : "failed", error, sentAt: Date.now() })]);
  }
  console.log({ sent, failed });
  return new Response(JSON.stringify({ sent, failed }));
};

export const config = { schedule: "* * * * *" };
