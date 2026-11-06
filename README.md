# CDOE Workboard

Centre for Distance and Online Education · Vignan's Foundation for Science, Technology & Research

Three tabs:

- **Activity Calendar**: webinars, Tech Talks, workshops, meetings and other department activities. Each one has a status (planned or completed), notes and Google Drive proof links.
- **Calendar of Events (COE)**: the academic calendar, covering semester commencements, continuous-assessment windows, end-semester examinations and holidays. Every entry carries its batch (for example *July 2025 – Sem III*), and the cards are coloured by batch.
- **Batches Status**: how many learners each programme admitted in each batch, how many have graduated, and a remarks line. Opens on a table of every batch; choose one to fill in the numbers.

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

## Batches Status

The tab opens on **All batches**: programmes down the side, batches across the top, exactly like the department intake sheet. Choose a batch, above or in the table, to open it.

A batch shows every programme with:

| Column | Where it comes from |
| ------ | ------------------- |
| Learners | the intake figure, which you can correct |
| Discontinued | typed in, or imported |
| Finished | those who completed the degree |
| Still on roll | worked out as Learners − Discontinued − Finished |
| Progress | of those who stayed, how many finished |
| Remarks | typed in |

Below that, **the learners still on roll** are broken down into Active, Not responding, Under 10 backlogs and Can finish by Apr 2027 — the follow-up figures from the department's report.

Numbers and remarks save by themselves, and **Saved ✓** appears at the end of the row. A dash means the programme took no intake in that batch; type a learner count to open it up. Finished and discontinued together can never come to more than the learner count, and the site says so rather than saving a wrong figure.

**Add a batch** creates a row for every programme, ready for next January. **Delete *batch*** removes one batch after you confirm. **Download Excel** gives two sheets: the wide intake table, and one row per batch and programme with every figure, the percentage and the remarks. **Print** gives the same thing on paper.

The intake figures load once, the first time the site starts after that tab arrived, so later corrections are never overwritten.

### Importing the batch-wise report

**Import report** reads the department's batch-wise status report: one sheet per batch, named for the batch ("Jan 2022", "July 2022"), each with a **Programme Name** column. These columns are found by their headings, wherever they sit and even when a heading runs over two rows:

- **Total Admitted** (or "Jan-2023 Admissions")
- **Discontinued** and **Completed Degree**
- **Active**, **Not Responding**, **&lt;10 backlogs**, **How many can complete by April 27**

Sanctioned intake, S.No. and % are ignored, and Remaining is worked out again rather than read. A dash means the programme took no intake. A figure written `22(1)` is read as 22, the way the sheet's own totals use it, and the bracket is reported.

Before anything is saved you see every figure that would change, old value struck through. Only the batches and programmes in the file are touched; **remarks typed on the site are never overwritten**, and a batch or programme not yet on the site is added. The site also checks the file against itself and reports anything that does not add up — a Total row that disagrees with its own column, a Remaining that does not match, a Not Responding larger than the number still on roll.

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
- The Batches Status intake figures are added on the first visit after that tab arrived.

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
SELECT batch, programme, admitted, discontinued, graduated, active, not_responding, backlogs_lt10, can_complete, remarks
  FROM batch_status ORDER BY sort_order, batch;
SELECT * FROM audit ORDER BY id DESC LIMIT 50;
```

## What is in here

```
api/_db.js          database connection, tables, upgrades
api/_auth.js        login check and sign-in token
api/read.js         GET  /api/read   (calendars, batches, health check)
api/save.js         POST /api/save   (every change)
public/index.html   the site
public/importer.js  reads the calendar workbooks
public/logo.jpg     the Vignan's Online logo
dev/server.mjs      local preview only, not used on Vercel
```
