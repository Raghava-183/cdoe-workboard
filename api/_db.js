/*
  Database layer.
  On Vercel: Neon Postgres through DATABASE_URL (added from Vercel → Storage → Neon).
  On your own computer: `npm run dev` uses a local PGlite folder instead, so you can
  try everything without an internet database.
*/

let _sql = null;

/* Finds the Neon connection string even if Vercel gave it a prefix
   (STORAGE_URL, NEON_DATABASE_URL, POSTGRES_URL and so on). */
function dbUrl() {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  const key = Object.keys(env).sort().find(k =>
    /_URL$/.test(k) && !/UNPOOLED|NON_POOLING|PRISMA/.test(k) &&
    /^postgres(ql)?:\/\//.test(env[k] || ''));
  return key ? env[key] : '';
}

/* Which database this server is using — host and variable name only, never the password. */
export function dbInfo() {
  const env = process.env, url = dbUrl();
  const host = u => { try { return new URL(u).hostname; } catch { return '?'; } };
  const vars = Object.keys(env).filter(k => /^postgres(ql)?:\/\//.test(env[k] || '')).sort()
    .map(k => ({ name: k, host: host(env[k]) }));
  return { using: vars.find(v => env[v.name] === url)?.name || (url ? '(other)' : 'none'), host: url ? host(url) : '', vars,
           deployment: env.VERCEL_URL || '', env: env.VERCEL_ENV || 'local', commit: (env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) };
}

export async function logSave(who, action, target, ok, detail) {
  try { await q`INSERT INTO audit (who, action, target, ok, detail) VALUES (${who || ''}, ${action || ''}, ${target || ''}, ${ok}, ${String(detail || '').slice(0, 300)})`; }
  catch (e) { console.error('audit:', e); }
}

async function getSql() {
  if (_sql) return _sql;

  const url = dbUrl();
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    _sql = neon(url);
  } else if (process.env.LOCAL_DB) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(process.env.LOCAL_DB);
    _sql = async (strings, ...values) => {
      let text = strings[0];
      values.forEach((_, i) => { text += '$' + (i + 1) + strings[i + 1]; });
      return (await db.query(text, values)).rows;
    };
  } else {
    throw new Error('No database connection found. In Vercel, open Storage, connect the Neon database to this project for Production, then redeploy.');
  }
  return _sql;
}

/* Tagged-template helper: await q`SELECT ...` */
export const q = async (strings, ...values) => (await getSql())(strings, ...values);

/*
  University holidays for July–December 2026, loaded into the Activity Calendar
  once, the first time the database is empty.
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


/*
  Batches Status: how many learners each programme admitted in each batch,
  how many have graduated, and a remarks line the team fills in.
  Admitted counts are the department's intake figures, loaded once.
*/
const PROGRAMMES = ['BBA', 'MBA (General)', 'MBA (Finance)', 'MBA HRM', 'BCA', 'MCA'];
const BATCHES = ['Jan-22', 'Jul-22', 'Jan-23', 'Jul-23', 'Jan-24', 'Jul-24', 'Jan-25', 'Jul-25', 'Jan-26', 'Jul-26'];
/* null means the programme took no intake in that batch. */
const ADMITTED = {
  'BBA':           [5, 303, 20, 54, 33, 73, 10, 37, 42, 98],
  'MBA (General)': [23, 948, 50, 490, 282, 587, 172, 381, 516, 1010],
  'MBA (Finance)': [21, 148, 183, 83, 44, 87, 25, 54, 35, 103],
  'MBA HRM':       [17, 166, 60, 113, 75, 108, 20, 38, 37, 88],
  'BCA':           [null, 87, 31, 98, 35, 93, 8, 37, 41, 74],
  'MCA':           [null, 250, null, 502, 154, 350, 53, 169, 139, 407]
};

let ready = false;

export async function ensure() {
  if (ready) return;

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

  /* Two calendars share one table: 'activity' (Activity Calendar) and 'coe' (Calendar of Events).
     Everything that existed before the split belongs to the Activity Calendar. */
  await q`ALTER TABLE events ADD COLUMN IF NOT EXISTS cal TEXT NOT NULL DEFAULT 'activity'`;
  await q`CREATE INDEX IF NOT EXISTS events_cal ON events (cal, start_date)`;

  /* The Day Tracker was removed (Oct 2026). Its faculty list and slot entries are deleted. */
  await q`DROP TABLE IF EXISTS day_entries`;
  await q`DROP TABLE IF EXISTS faculty`;

  /* The holidays are loaded once, ever. After that, deleting them from the
     site keeps them deleted. */
  await q`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')`;
  const [seeded] = await q`SELECT 1 AS x FROM meta WHERE k = 'holidays_seeded'`;
  if (!seeded) {
    const [{ n }] = await q`SELECT count(*)::int AS n FROM events`;
    if (n === 0) {
      const s = SEED_EVENTS.map(r => r[0]), e = SEED_EVENTS.map(r => r[1]);
      const c = SEED_EVENTS.map(r => r[2]), t = SEED_EVENTS.map(r => r[3]);
      await q`
        INSERT INTO events (start_date, end_date, category, title, updated_by)
        SELECT a::date, b::date, c, d, 'University calendar'
        FROM unnest(${s}::text[], ${e}::text[], ${c}::text[], ${t}::text[]) AS x(a, b, c, d)`;
    }
    await q`INSERT INTO meta (k, v) VALUES ('holidays_seeded', 'yes') ON CONFLICT (k) DO NOTHING`;
  }

  await q`
    CREATE TABLE IF NOT EXISTS batch_status (
      batch      TEXT NOT NULL,
      programme  TEXT NOT NULL,
      sort_order INT  NOT NULL DEFAULT 0,
      admitted   INT,
      graduated  INT  NOT NULL DEFAULT 0,
      remarks    TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (batch, programme)
    )`;

  /* Nov 2026: the batch-wise status report tracks more than the intake and the
     passes. Discontinued matters most: those learners are not "not graduated",
     they have left, so they are counted apart. Added to whatever is already in
     the table, so nothing recorded by hand is disturbed. */
  await q`ALTER TABLE batch_status ADD COLUMN IF NOT EXISTS discontinued   INT`;
  await q`ALTER TABLE batch_status ADD COLUMN IF NOT EXISTS active         INT`;
  await q`ALTER TABLE batch_status ADD COLUMN IF NOT EXISTS not_responding INT`;
  await q`ALTER TABLE batch_status ADD COLUMN IF NOT EXISTS backlogs_lt10  INT`;
  await q`ALTER TABLE batch_status ADD COLUMN IF NOT EXISTS can_complete   INT`;

  /* The intake figures are loaded once, ever, so later edits are never overwritten. */
  const [bseeded] = await q`SELECT 1 AS x FROM meta WHERE k = 'batches_seeded'`;
  if (!bseeded) {
    const b = [], p = [], o = [], n = [];
    PROGRAMMES.forEach((prog, pi) => BATCHES.forEach((batch, bi) => {
      b.push(batch); p.push(prog); o.push(pi + 1); n.push(ADMITTED[prog][bi]);
    }));
    await q`
      INSERT INTO batch_status (batch, programme, sort_order, admitted, updated_by)
      SELECT x.b, x.p, x.o, x.n, 'Department intake sheet'
      FROM unnest(${b}::text[], ${p}::text[], ${o}::int[], ${n}::int[]) AS x(b, p, o, n)
      ON CONFLICT (batch, programme) DO NOTHING`;
    await q`INSERT INTO meta (k, v) VALUES ('batches_seeded', 'yes') ON CONFLICT (k) DO NOTHING`;
  }

  /* Nov 2026: the Jul-22 intake for BCA and MCA was missing from the first sheet.
     Filled in only where nobody has typed a figure, so entries are never overwritten. */
  const [j22] = await q`SELECT 1 AS x FROM meta WHERE k = 'batches_jul22'`;
  if (!j22) {
    await q`UPDATE batch_status SET admitted = 87
            WHERE batch = 'Jul-22' AND programme = 'BCA' AND admitted IS NULL`;
    await q`UPDATE batch_status SET admitted = 250
            WHERE batch = 'Jul-22' AND programme = 'MCA' AND admitted IS NULL`;
    await q`INSERT INTO meta (k, v) VALUES ('batches_jul22', 'yes') ON CONFLICT (k) DO NOTHING`;
  }

  /* Every save attempt, kept so problems can be traced. */
  await q`
    CREATE TABLE IF NOT EXISTS audit (
      id     BIGSERIAL PRIMARY KEY,
      at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      who    TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '',
      ok     BOOLEAN NOT NULL DEFAULT true,
      detail TEXT NOT NULL DEFAULT ''
    )`;

  ready = true;
}

/* ---------- readers ---------- */

export async function readCalendar() {
  const events = await q`
    SELECT id::text AS id,
           to_char(start_date, 'YYYY-MM-DD') AS start,
           to_char(end_date,   'YYYY-MM-DD') AS "end",
           cal, category, title, audience, status, notes, cancelled,
           updated_by AS by
    FROM events ORDER BY start_date, id`;
  const proofs = await q`
    SELECT id::text AS id, event_id::text AS event_id, label, url, added_by AS by,
           to_char(added_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS added
    FROM proofs ORDER BY added_at`;
  return { events, proofs };
}

export async function readBatches() {
  const rows = await q`
    SELECT batch, programme, sort_order, admitted, graduated, discontinued,
           active, not_responding, backlogs_lt10, can_complete,
           remarks, updated_by AS by,
           to_char(updated_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS at
    FROM batch_status ORDER BY sort_order, programme`;
  return { batches: rows };
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
