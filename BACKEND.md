# Backend handoff: a-tom. Production Pipeline

The app runs in two modes:
- **Local mode (default).** Data is saved in the browser only, so you can open `Production pipeline.html` straight from VS Code (use Live Server). A "Local mode" banner is shown on the home page.
- **Supabase mode.** Turns on automatically once `config.js` has a real `supabaseUrl` and `supabaseAnonKey`. See `SUPABASE-SETUP.md`. `supabase-setup.sql` already covers everything listed below.

Both modes use the same interface: `db.collection(path).where/orderBy/limit/get/onSnapshot` and `db.doc(path).set/update`. `update` deep-merges the patch, and a `null` value deletes that key. Everything is stored as JSON documents keyed by path.

## Collections
| Path | What it holds |
|---|---|
| `team/{id}` | `name, role, email, userId, order`. A role containing "Approver" receives sign-off emails. |
| `projects/{pid}` | Production: name, client, dates, deliverables |
| `projects/{pid}/stages/{sid}` | Stage: checklist, owners, files, links, notes |
| `projects/{pid}/log/{day}` | Activity log |
| `signoffs/{pid}__{sid}` | Approvals and overrides |
| `chat/all/msgs/{id}` | Team-wide chat on the home dashboard |
| `chat/{pid}/msgs/{id}` | Project chat (the Chat tab). Fields: `at, by, mid, text, mentions[]` |
| `notices/{id}` | In-app notifications: `mid, kind (mention/assigned/signed), text, snippet, pid, sid, room, byName, at, readAt` |
| `outbox/{id}` | **Email queue** for the backend to send: `to, toName, subject, text, link, kind, status, at` |

## Mandatory notifications
- **Bell in the top bar.** Shows every open stage on your name (overdue, late checklist items, due soon, still to fill in), plus tags, new assignments, stages waiting for sign-off and stages needing review.
- **Must-acknowledge popup.** Appears each session, and again whenever something new and urgent comes up.
- **Alarm.** A sound plus a browser pop-up that repeats every hour, every 2 hours or once a day. It can't be switched off.
- **Email required.** Anyone who hasn't added an email sees a banner asking for one.

## What your backend needs to do
1. **Send the outbox.** For each `outbox` row with `status = "queued"`, send the email (Resend, SendGrid or SES), then set `status` to `"sent"` or `"failed"`. You can trigger this with a Supabase Database Webhook on insert into `docs` where `col = 'outbox'`, or with a cron job every minute.
2. **Daily overdue digest (cron, around 9am IST).** For each team member with an email:
   - Collect the stages they own that are not signed off and not locked, where `due < today`, or where any checklist item has `due < today` and isn't ticked.
   - Email them the list with links in the form `{site}#/p/{pid}/pipeline/{sid}`.
   - The browser can't do this on its own, because it only runs while a tab is open.
3. **Optional hardening.** Replace the approver code with Supabase Auth (email magic link), and tighten the row-level security rules to signed-in users only.

## Sample edge function (outbox sender)
```ts
// supabase/functions/send-outbox/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve(async () => {
  const { data } = await sb.from("docs").select("path,data").eq("col", "outbox").eq("data->>status", "queued").limit(50);
  for (const r of data ?? []) {
    const m = r.data;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "a-tom. Pipeline <pipeline@atomcontent.in>", to: m.to, subject: m.subject, text: m.text }),
    });
    await sb.rpc("doc_update", { p_path: r.path, p_patch: { status: res.ok ? "sent" : "failed", sentAt: Date.now() } });
  }
  return new Response("ok");
});
```

## Files to download
`Production pipeline.html`, `config.js`, `local-adapter.js`, `supabase-adapter.js`, `supabase-setup.sql`, `SUPABASE-SETUP.md`, `BACKEND.md`
