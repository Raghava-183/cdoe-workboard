# CDOE Workboard

Centre for Distance and Online Education · Vignan's Foundation for Science, Technology & Research

Two calendars, one tab each:

- **Activity Calendar**: webinars, Tech Talks, workshops, meetings and other department activities. Each one has a status (planned or completed), notes and Google Drive proof links.
- **Calendar of Events (COE)**: the academic calendar, covering semester commencements, continuous-assessment windows, end-semester examinations and holidays. Every entry carries its batch (for example *July 2025 – Sem III*), and the cards are coloured by batch.

Both calendars have a month view with a strip of every month, a list view you can print, full-screen mode for a projector, and Import, Add and Delete. Anyone with the link can view. Editing needs the department login. Vercel serves the site and Neon Postgres stores the data.

---

## Importing a calendar

Open the tab, sign in, and choose **Import from Excel**. Three layouts are read as they are:

1. **The Master Calendar of Events workbook**: month boxes holding the date and its lines, such as `• July 2025 – Sem III: Continuous Assessment – I Submission Window Open`. The batch is taken from the start of each line.
2. **The department activity calendar workbook**: a row of day numbers with the events typed under each day. The workbook's own colour key (HOLIDAY, Tech Talks …) sets the types.
3. **A table** with Start date, End date, Title, Type and For/Batch. **Download a blank table** in the import window gives a starter file.

You see every entry, and can change its type, before anything is saved. Then choose:

- **Add the new entries**: only entries that are not on the calendar yet are added. Titles are matched ignoring case, spaces and dashes, so importing the same file twice adds nothing.
- **Replace the calendar with this file**: entries that are no longer in the file are removed, **except** ones with proof links, notes or a Completed status, which are always kept. Use this when an updated calendar arrives.

**Delete calendar** clears one calendar, either in full or for a date range, after you type DELETE. The other calendar is never touched.

## Everyday use

- **Add one entry**: use **Add activity** or **Add event**, or hover over a day and click **+**.
- **Proof** (Activity Calendar): open an activity and paste the Google Drive link. It saves by itself. Set the file to *Anyone with the link can view* first.
- **Notes**: they save a second after you stop typing, and again when the popup closes.
- **Find things**: filter by type, or by batch on the COE, or search. **Next 14 days** under the calendar shows what's coming up.
- **Report**: open **List & report**, then **Print**. Choose "Save as PDF" in the print window to get a PDF.
- **Projector**: **Full screen** shows only the logo, the month and the calendar. Press Esc to leave.

## Deploying an update

Commit and push to GitHub. Vercel redeploys by itself. Database changes run on the first visit after a deploy:

- Activities that existed before the COE was added stay on the Activity Calendar.
- The Day Tracker was removed in October 2026. Its `faculty` and `day_entries` tables are deleted.

## First-time setup (new copy of the site)

1. Push this folder to a GitHub repository, then in Vercel choose **Add New → Project** and pick it. Framework: "Other".
2. **Storage → Create Database → Neon** (free plan, Mumbai or Singapore), then **Connect Project** with Production ticked. Any variable prefix works.
3. **Settings → Environment Variables**: add `LOGIN_ID` and `LOGIN_PASSWORD`. Never put the real password in the code, because the repository can be public.
4. **Deployments → ⋯ → Redeploy.**

## Changing the password

**Settings → Environment Variables → edit `LOGIN_PASSWORD` → Save → Redeploy.** Everyone signed in is signed out.

## Checking the server

`/api/read?what=health` shows which database the site uses, how many entries each calendar holds, and the last 25 saves. It never shows the password.

## Try it on your own computer

```
npm install
cp .env.example .env.local        (Windows: copy .env.example .env.local)
```

Put the login in `.env.local`, delete the `DATABASE_URL` line, then run `npm run dev` and open http://localhost:3000. This uses a local database folder (`.localdb`), so nothing touches the live site.

## Looking at the data directly

In Vercel, open the Neon database and use the SQL editor:

```sql
SELECT cal, start_date, end_date, category, title, audience FROM events ORDER BY cal, start_date;
SELECT * FROM proofs ORDER BY added_at DESC;
SELECT * FROM audit ORDER BY id DESC LIMIT 50;
```

## What is in here

```
api/_db.js          database connection, tables, upgrades
api/_auth.js        login check and sign-in token
api/read.js         GET  /api/read   (both calendars, health check)
api/save.js         POST /api/save   (every change)
public/index.html   the site
public/importer.js  reads the calendar workbooks
public/logo.jpg     the Vignan's Online logo
dev/server.mjs      local preview only, not used on Vercel
```
