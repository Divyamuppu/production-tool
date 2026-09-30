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
