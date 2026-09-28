# Supabase setup: a-tom. Production Pipeline

1. **Create the project.** Go to supabase.com, create a new project, and wait for it to finish setting up.
2. **Create the database.** Open **SQL Editor**, paste all of `supabase-setup.sql`, and click **Run**.
3. **Get your keys.** Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. **Fill in the config.** Open `Production pipeline.html` and find `PIPELINE_CONFIG` near the top: paste the URL and key, and change `approverCode` to a code of your own.
5. **Publish it.** Drag the folder containing `Production pipeline.html`, `config.js` and `supabase-adapter.js` onto app.netlify.com/drop. Vercel or GitHub Pages also work. The page opens at `/Production%20pipeline.html`; rename the file to `index.html` if you want a clean link.
6. **Share it.** Send the link to the team. Everyone with the link can view and edit, and changes appear for everyone right away.
7. **Become the approver.** Open the link once with `?approver=YOUR-CODE` at the end, for example `https://site.netlify.app/?approver=YOUR-CODE`. That browser gets sign-off and override rights. Use `?approver=off` to remove them.

## Notes
- **Identity.** Each browser gets its own id. People pick their name from the "Which one are you?" banner.
- **Security.** The approver code sits in so anyone who opens that file can read it. This is fine for an internal team link. Before sharing outside the team, switch to proper Supabase sign-in (email magic link).
- **Files.** Uploads go to the public `pipeline-files` bucket, so anyone who has a file's link can open it.
