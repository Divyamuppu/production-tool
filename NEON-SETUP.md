# Neon setup — a-tom. Production Pipeline

How it fits together:
- **Neon** is the database.
- **Netlify Functions** (`/api`) sit between the app and Neon, so the database password never reaches the browser.
- **Netlify Blobs** stores uploaded files.
- **Resend** sends the emails.

## 1. Create the database
1. Go to neon.tech and create a project, e.g. "atom-pipeline", in the Singapore or Mumbai region (AWS ap-southeast-1 or ap-south-1).
2. No SQL needed: the site creates its tables automatically on first load. (`neon-setup.sql` is kept for reference.)
3. Go to **Connection details** and copy the connection string (`postgresql://…neon.tech/neondb?sslmode=require`).

## 2. Add the keys to Netlify
Go to Netlify → your site → **Site configuration → Environment variables** and add:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `RESEND_API_KEY` | your Resend key |
| `MAIL_FROM` | sender for all emails, e.g. `Pipeline <pipeline@yourdomain.com>` (must be a domain verified in Resend) |
| `APPROVER_EMAILS` | optional, comma-separated emails of people who can sign off and override |
| `ALLOWED_EMAIL_DOMAINS` | optional, e.g. `yourdomain.com` to limit sign-up to one domain. Leave empty to let anyone sign up |
| `REQUIRE_LOGIN` | leave unset (on). Set to `false` to open the site without sign-in |

## 3. Push to GitHub
Netlify deploys automatically. The site serves the app, `/api` (the database), and a job that sends emails every minute.

## Sign in
- Open the site, enter your email, and tap the link in the email. That's it: no separate sign-up.
- First-time emails are added to the Team automatically (name taken from the email, editable on the Team tab). Emails already on the Team are matched to that person.
- People stay signed in for a year on that device and in the installed app.

## Email notifications
- Tags, assignments, sign-offs and "needs review" alerts are queued and sent every minute by `netlify/functions/send-outbox.mjs`.
- Sign-in links are sent straight away.
- Both send from `MAIL_FROM` through Resend, using a domain you have verified in Resend.

## 4. Install on phones
- **Android (Chrome):** open the site and tap **Install** in the banner, or use ⋮ → *Install app*.
- **iPhone (Safari):** tap **Share**, then **Add to Home Screen**.

The app opens full screen with the a-tom. icon, and loads instantly even on a weak connection.

## Notes
- Live updates refresh every 3 seconds while the app is open.
- Uploaded files must be under 5.5 MB. Add bigger files (cuts, decks) as links.
- Only signed-in people can read or edit the data, and see uploaded files.
- Check the email queue in Neon's SQL Editor:
  ```sql
  select data->>'toName', data->>'to', data->>'status', data->>'error', updated_at
  from docs where col = 'outbox' order by updated_at desc limit 20;
  ```
