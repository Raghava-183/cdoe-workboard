# CDOE Workboard

Centre for Distance and Online Education · Vignan's Foundation for Science, Technology & Research

Two tabs:

- **Activity Calendar** — department activities from July to December 2026, each with a status (planned or completed), notes and Google Drive proof links. Month view, a list view, and a printable report.
- **Day Tracker** — every faculty member gets four slots for every working day, Monday to Saturday, up to 31 December 2026:

  | Slot | Time |
  | ---- | ---- |
  | Slot 1 | 8:15 AM – 10:00 AM |
  | Slot 2 | 10:00 AM – 12:00 PM |
  | Slot 3 | 12:00 PM – 2:00 PM |
  | Slot 4 | 2:00 PM – 4:00 PM |

  Slots save by themselves a moment after you stop typing. The week overview shows who has filled what, and **Download Excel** exports any date range.

Anyone with the link can view. Editing needs the department login. Same shape as the Activity Calendar project: Vercel in front, Neon Postgres behind.

---

## Deploy — step by step

### 1. Put the code on GitHub

Create an empty repository named `cdoe-workboard`, then from this folder:

```
git init
git add .
git commit -m "CDOE Workboard"
git branch -M main
git remote add origin https://github.com/<your-username>/cdoe-workboard.git
git push -u origin main
```

### 2. Import it into Vercel

On vercel.com, **Add New → Project**, pick the repository, deploy. Leave the framework as "Other".
It will show an error on opening. Expected — no database yet.

### 3. Add the database

**Storage → Create Database → Neon** → free plan, Mumbai or Singapore region.
**Connect Project** → choose `cdoe-workboard`, tick **Production**, and **leave Custom Prefix empty** so the variable is called exactly `DATABASE_URL`.

Tables are created automatically on the first visit, and the university holidays for July–December 2026 are loaded once.

### 4. Set the login

Project → **Settings → Environment Variables**. Add two:

| Name | Value |
| ---- | ----- |
| `LOGIN_ID` | the login ID |
| `LOGIN_PASSWORD` | the password |

Set them here only. Never put the real password in the code or in `.env.example` — the GitHub repository can be public.

### 5. Redeploy

**Deployments → newest → ⋯ → Redeploy.** Environment variables reach the code only after a redeploy.

### 6. Upload the faculty list

Open the site → **Sign in to edit** → **Day Tracker → Faculty list** → choose your Excel or CSV file.
Columns: **Name, Employee ID, Designation** (headings in the first row; extra columns such as S.No are ignored).
You see a preview before anything is saved. Upload again any time: people are matched by Employee ID and updated.

---

## Everyday use

- **Fill slots** — Day Tracker → pick the day → type in the four boxes. "Saved" appears under the person's name.
- **Check progress** — the red bar under each day shows how much is filled. **Only incomplete** hides people who are done. **Week overview** shows the whole week at once.
- **Holidays** — days marked Holiday on the calendar show a notice in the Day Tracker. Entries stay optional.
- **Add an activity** — Activity Calendar → **Add activity**, or **Import from Excel** with columns Start date, End date, Title, Type, For.
- **Proof** — open an activity → paste a Google Drive link → **Attach link**. Set the file to *Anyone with the link can view* first.
- **Report** — Activity Calendar → **List & report** → **Print report** (choose "Save as PDF" in the print dialog for a PDF).

## Changing the dates or slot times

At the top of the script in `public/index.html`:

```js
const CONFIG = {
  from: "2026-07-01",
  to:   "2026-12-31",
  workDays: [1,2,3,4,5,6],   // Monday to Saturday
  slots: [ ... ]
};
```

Edit, commit, push. Vercel redeploys by itself. Saved entries are not touched.

## Changing the password

**Settings → Environment Variables → edit `LOGIN_PASSWORD` → Save → Redeploy.** Everyone who was signed in is signed out.

## Try it on your own computer

```
npm install
copy .env.example .env.local      (Windows)   or   cp .env.example .env.local
```

Put the login in `.env.local`, delete the `DATABASE_URL` line, then `npm run dev` and open http://localhost:3000.
It uses a local database folder (`.localdb`), so nothing touches the live site.

## Looking at the data directly

In Vercel, open the Neon database → SQL editor:

```sql
SELECT * FROM faculty ORDER BY sort_order;
SELECT day, emp_id, slot, body, updated_by, updated_at FROM day_entries ORDER BY day DESC, emp_id, slot;
SELECT * FROM events ORDER BY start_date;
SELECT * FROM proofs ORDER BY added_at DESC;
```

## If something goes wrong

- **Error on opening** — the database is not connected, or you did not redeploy. Check that `DATABASE_URL` is listed exactly with that name.
- **"LOGIN_ID and LOGIN_PASSWORD are not set"** — add them in step 4 and redeploy.
- **"Not saved" under a name** — the connection dropped. Type in the box again and it retries. Vercel → **Logs** shows the reason for any red `/api/save` line.

## What is in here

```
api/_db.js        database connection, tables, holiday list
api/_auth.js      login check and sign-in token
api/read.js       GET  /api/read   — calendar, a day's slots, week counts, Excel range
api/save.js       POST /api/save   — every change
public/index.html the whole site
public/logo.jpg   the Vignan's Online logo
dev/server.mjs    local preview only (not used on Vercel)

Deployed for CDOE
```
