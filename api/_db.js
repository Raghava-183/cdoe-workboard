/*
  Database layer.
  On Vercel: Neon Postgres through DATABASE_URL (added from Vercel → Storage → Neon).
  On your own computer: `npm run dev` uses a local PGlite folder instead, so you can
  try everything without an internet database.
*/

let _sql = null;

async function getSql() {
  if (_sql) return _sql;

  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    _sql = neon(process.env.DATABASE_URL);
  } else if (process.env.LOCAL_DB) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(process.env.LOCAL_DB);
    _sql = async (strings, ...values) => {
      let text = strings[0];
      values.forEach((_, i) => { text += '$' + (i + 1) + strings[i + 1]; });
      return (await db.query(text, values)).rows;
    };
  } else {
    throw new Error('DATABASE_URL is not set. Connect the Neon database in Vercel and redeploy.');
  }
  return _sql;
}

/* Tagged-template helper: await q`SELECT ...` */
export const q = async (strings, ...values) => (await getSql())(strings, ...values);

/*
  University holidays for July–December 2026, taken from the department activity
  calendar. Loaded once, the first time the database is empty. Edit or cancel
  them from the site if CDOE follows a different list.
*/
const SEED_EVENTS = [
  ['2026-08-15', '2026-08-15', 'holiday', 'Independence Day'],
  ['2026-08-25', '2026-08-25', 'holiday', 'Milad-un-Nabi'],
  ['2026-09-04', '2026-09-04', 'holiday', 'Krishnashtami'],
  ['2026-09-14', '2026-09-14', 'holiday', 'Vinayaka Chavithi'],
  ['2026-10-02', '2026-10-02', 'holiday', 'Gandhi Jayanthi'],
  ['2026-10-18', '2026-10-18', 'observance', 'Durgashtami'],
  ['2026-10-19', '2026-10-19', 'holiday', 'Dasara holiday'],
  ['2026-10-20', '2026-10-20', 'holiday', 'Vijaya Dasami'],
  ['2026-10-21', '2026-10-21', 'holiday', 'Dasara holiday'],
  ['2026-11-08', '2026-11-08', 'observance', 'Deepavali'],
  ['2026-12-25', '2026-12-25', 'holiday', 'Christmas']
];

let ready = false;

export async function ensure() {
  if (ready) return;

  await q`
    CREATE TABLE IF NOT EXISTS faculty (
      emp_id      TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      designation TEXT NOT NULL DEFAULT '',
      sort_order  INT  NOT NULL DEFAULT 0,
      active      BOOLEAN NOT NULL DEFAULT true,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  await q`
    CREATE TABLE IF NOT EXISTS day_entries (
      day        DATE NOT NULL,
      emp_id     TEXT NOT NULL,
      slot       SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 4),
      body       TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (day, emp_id, slot)
    )`;

  await q`
    CREATE TABLE IF NOT EXISTS events (
      id         BIGSERIAL PRIMARY KEY,
      start_date DATE NOT NULL,
      end_date   DATE NOT NULL,
      category   TEXT NOT NULL DEFAULT 'event',
      title      TEXT NOT NULL,
      audience   TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'planned',
      notes      TEXT NOT NULL DEFAULT '',
      cancelled  BOOLEAN NOT NULL DEFAULT false,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  await q`
    CREATE TABLE IF NOT EXISTS proofs (
      id        BIGSERIAL PRIMARY KEY,
      event_id  BIGINT NOT NULL,
      label     TEXT NOT NULL DEFAULT 'Supporting document',
      url       TEXT NOT NULL,
      added_by  TEXT NOT NULL DEFAULT '',
      added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  await q`CREATE INDEX IF NOT EXISTS proofs_event ON proofs (event_id)`;
  await q`CREATE INDEX IF NOT EXISTS entries_emp ON day_entries (emp_id, day)`;

  const [{ n }] = await q`SELECT count(*)::int AS n FROM events`;
  if (n === 0) {
    const s = SEED_EVENTS.map(r => r[0]), e = SEED_EVENTS.map(r => r[1]);
    const c = SEED_EVENTS.map(r => r[2]), t = SEED_EVENTS.map(r => r[3]);
    await q`
      INSERT INTO events (start_date, end_date, category, title, updated_by)
      SELECT a::date, b::date, c, d, 'University calendar'
      FROM unnest(${s}::text[], ${e}::text[], ${c}::text[], ${t}::text[]) AS x(a, b, c, d)`;
  }

  ready = true;
}

/* ---------- readers ---------- */

export async function readCalendar() {
  const events = await q`
    SELECT id::text AS id,
           to_char(start_date, 'YYYY-MM-DD') AS start,
           to_char(end_date,   'YYYY-MM-DD') AS "end",
           category, title, audience, status, notes, cancelled,
           updated_by AS by
    FROM events ORDER BY start_date, id`;
  const proofs = await q`
    SELECT id::text AS id, event_id::text AS event_id, label, url, added_by AS by,
           to_char(added_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS added
    FROM proofs ORDER BY added_at`;
  return { events, proofs };
}

export async function readFaculty(includeInactive = false) {
  return includeInactive
    ? q`SELECT emp_id, name, designation, active FROM faculty ORDER BY sort_order, name`
    : q`SELECT emp_id, name, designation, active FROM faculty WHERE active ORDER BY sort_order, name`;
}

export async function readDay(day) {
  const faculty = await readFaculty();
  const entries = await q`
    SELECT emp_id, slot, body, updated_by AS by,
           to_char(updated_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH12:MI AM') AS at
    FROM day_entries WHERE day = ${day}::date AND body <> ''`;
  return { day, faculty, entries };
}

/* How many of the four slots each faculty member filled, per day. */
export async function readCounts(from, to) {
  const faculty = await readFaculty();
  const counts = await q`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, emp_id, count(*)::int AS n
    FROM day_entries
    WHERE day BETWEEN ${from}::date AND ${to}::date AND body <> ''
    GROUP BY day, emp_id`;
  return { from, to, faculty, counts };
}

/* Every entry in a range — used for the Excel download. */
export async function readRange(from, to) {
  const faculty = await readFaculty(true);
  const entries = await q`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, emp_id, slot, body
    FROM day_entries
    WHERE day BETWEEN ${from}::date AND ${to}::date AND body <> ''
    ORDER BY day, emp_id, slot`;
  return { from, to, faculty, entries };
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2_000_000) reject(new Error('Request too large')); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Could not read the request')); }
    });
    req.on('error', reject);
  });
}
