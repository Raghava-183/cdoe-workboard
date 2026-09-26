import { q, ensure, readCalendar, readFaculty, readBody } from './_db.js';
import { login, verify } from './_auth.js';

const CATS = ['holiday', 'observance', 'exam', 'admission', 'orientation', 'counselling',
  'webinar', 'workshop', 'fdp', 'meeting', 'content', 'event'];
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const txt = (v, n) => String(v ?? '').trim().slice(0, n);

class Bad extends Error { constructor(m) { super(m); this.code = 400; } }

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Use POST' }); return; }

  let b;
  try { b = await readBody(req); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); return; }

  try {
    if (b.action === 'login') {
      const s = login(b.id, b.password, b.name);
      if (!s) { res.status(403).json({ ok: false, error: 'That login ID or password is not correct' }); return; }
      res.status(200).json({ ok: true, token: s.token, who: s.who });
      return;
    }

    const who = verify(b.token);
    if (!who) { res.status(401).json({ ok: false, error: 'Your sign-in has expired. Sign in again to keep editing.' }); return; }
    if (b.action === 'check') { res.status(200).json({ ok: true, who }); return; }

    await ensure();
    const out = await run(b, who);
    res.status(200).json(Object.assign({ ok: true }, out));
  } catch (err) {
    if (err.code !== 400) console.error('save:', err);
    res.status(err.code === 400 ? 400 : 500).json({ ok: false, error: String(err.message || err) });
  }
}

async function run(b, who) {
  switch (b.action) {

    /* ---------- Day Tracker ---------- */

    case 'setSlot': {
      if (!isDay(b.date)) throw new Bad('A valid date is needed');
      const slot = Number(b.slot);
      if (![1, 2, 3, 4].includes(slot)) throw new Bad('Slot must be 1 to 4');
      const emp = txt(b.emp_id, 40), body = txt(b.body, 2000);
      const [f] = await q`SELECT 1 FROM faculty WHERE emp_id = ${emp}`;
      if (!f) throw new Bad('That faculty member is not in the list');
      const [r] = await q`
        INSERT INTO day_entries (day, emp_id, slot, body, updated_by, updated_at)
        VALUES (${b.date}::date, ${emp}, ${slot}, ${body}, ${who}, now())
        ON CONFLICT (day, emp_id, slot) DO UPDATE
          SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()
        RETURNING to_char(updated_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH12:MI AM') AS at`;
      return { at: r.at, by: who };
    }

    case 'setFaculty': {
      const rows = (Array.isArray(b.rows) ? b.rows : [])
        .map(r => ({ id: txt(r.emp_id, 40), name: txt(r.name, 120), des: txt(r.designation, 120) }))
        .filter(r => r.id && r.name);
      if (!rows.length) throw new Bad('No faculty rows with both a name and an employee ID');
      const ids = rows.map(r => r.id);
      if (new Set(ids).size !== ids.length) throw new Bad('The same employee ID appears twice in the file');
      await q`
        INSERT INTO faculty (emp_id, name, designation, sort_order, active, updated_at)
        SELECT a, n, d, o, true, now()
        FROM unnest(${ids}::text[], ${rows.map(r => r.name)}::text[],
                    ${rows.map(r => r.des)}::text[], ${rows.map((_, i) => i + 1)}::int[]) AS x(a, n, d, o)
        ON CONFLICT (emp_id) DO UPDATE
          SET name = EXCLUDED.name, designation = EXCLUDED.designation,
              sort_order = EXCLUDED.sort_order, active = true, updated_at = now()`;
      if (b.removeMissing) {
        await q`UPDATE faculty SET active = false, updated_at = now() WHERE NOT (emp_id = ANY(${ids}::text[]))`;
      }
      return { faculty: await readFaculty(true) };
    }

    case 'saveFaculty': {
      const id = txt(b.emp_id, 40), name = txt(b.name, 120), des = txt(b.designation, 120);
      if (!id || !name) throw new Bad('Name and employee ID are both needed');
      if (b.isNew) {
        const [x] = await q`SELECT active FROM faculty WHERE emp_id = ${id}`;
        if (x && x.active) throw new Bad('Employee ID ' + id + ' is already in the list');
      }
      await q`
        INSERT INTO faculty (emp_id, name, designation, sort_order, active)
        VALUES (${id}, ${name}, ${des}, (SELECT coalesce(max(sort_order), 0) + 1 FROM faculty), true)
        ON CONFLICT (emp_id) DO UPDATE
          SET name = EXCLUDED.name, designation = EXCLUDED.designation, active = true, updated_at = now()`;
      return { faculty: await readFaculty(true) };
    }

    case 'removeFaculty':
    case 'restoreFaculty': {
      const on = b.action === 'restoreFaculty';
      await q`UPDATE faculty SET active = ${on}, updated_at = now() WHERE emp_id = ${txt(b.emp_id, 40)}`;
      return { faculty: await readFaculty(true) };
    }

    /* ---------- Activity Calendar ---------- */

    case 'saveEvent': {
      const e = cleanEvent(b);
      if (b.id) {
        await q`
          UPDATE events SET start_date = ${e.start}::date, end_date = ${e.end}::date,
            category = ${e.category}, title = ${e.title}, audience = ${e.audience},
            cancelled = false, updated_by = ${who}, updated_at = now()
          WHERE id = ${String(b.id)}::bigint`;
      } else {
        await q`
          INSERT INTO events (start_date, end_date, category, title, audience, updated_by)
          VALUES (${e.start}::date, ${e.end}::date, ${e.category}, ${e.title}, ${e.audience}, ${who})`;
      }
      return readCalendar();
    }

    case 'importEvents': {
      const rows = (Array.isArray(b.rows) ? b.rows : []).map(cleanEvent);
      if (!rows.length) throw new Bad('No activities to add');
      await q`
        INSERT INTO events (start_date, end_date, category, title, audience, updated_by)
        SELECT s::date, e::date, c, t, a, ${who}
        FROM unnest(${rows.map(r => r.start)}::text[], ${rows.map(r => r.end)}::text[],
                    ${rows.map(r => r.category)}::text[], ${rows.map(r => r.title)}::text[],
                    ${rows.map(r => r.audience)}::text[]) AS x(s, e, c, t, a)`;
      return readCalendar();
    }

    case 'setStatus': {
      const st = b.status === 'completed' ? 'completed' : 'planned';
      await q`UPDATE events SET status = ${st}, updated_by = ${who}, updated_at = now() WHERE id = ${String(b.id)}::bigint`;
      return readCalendar();
    }

    case 'setNotes': {
      await q`UPDATE events SET notes = ${txt(b.notes, 5000)}, updated_by = ${who}, updated_at = now() WHERE id = ${String(b.id)}::bigint`;
      return readCalendar();
    }

    case 'cancelEvent':
    case 'restoreEvent': {
      const gone = b.action === 'cancelEvent';
      await q`UPDATE events SET cancelled = ${gone}, updated_by = ${who}, updated_at = now() WHERE id = ${String(b.id)}::bigint`;
      return readCalendar();
    }

    case 'addProof': {
      const url = txt(b.url, 2000);
      if (!/^https?:\/\//i.test(url)) throw new Bad('That is not a valid link. It should start with https://');
      await q`
        INSERT INTO proofs (event_id, label, url, added_by)
        VALUES (${String(b.id)}::bigint, ${txt(b.label, 120) || 'Supporting document'}, ${url}, ${who})`;
      return readCalendar();
    }

    case 'removeProof': {
      await q`DELETE FROM proofs WHERE id = ${String(b.proof_id)}::bigint`;
      return readCalendar();
    }

    default:
      throw new Bad('Unknown action');
  }
}

function cleanEvent(b) {
  const start = isDay(b.start) ? String(b.start) : null;
  const end = isDay(b.end) ? String(b.end) : start;
  const title = txt(b.title, 300);
  if (!start) throw new Bad('A valid start date is needed');
  if (end < start) throw new Bad('The end date is before the start date');
  if (!title) throw new Bad('A title is needed');
  return {
    start, end, title,
    category: CATS.includes(b.category) ? b.category : 'event',
    audience: txt(b.audience, 200)
  };
}
