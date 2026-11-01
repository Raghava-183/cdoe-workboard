import { q, ensure, readCalendar, readBatches, readBody, logSave } from './_db.js';
import { login, verify } from './_auth.js';

const CATS = ['holiday', 'observance', 'semester', 'assessment', 'techtalk', 'exam', 'admission',
  'orientation', 'counselling', 'webinar', 'workshop', 'fdp', 'meeting', 'content', 'event',
  'registration', 'result', 'vacation', 'academic'];
const CALS = ['activity', 'coe'];
const calOf = v => (CALS.includes(v) ? v : 'activity');
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const txt = (v, n) => String(v ?? '').trim().slice(0, n);
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

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

    if (b.action === 'report') {
      await ensure();
      await logSave('browser ' + String(b.who || '').slice(0, 40), 'report', '', false, String(b.msg || '').slice(0, 280));
      res.status(200).json({ ok: true });
      return;
    }

    const who = verify(b.token);
    if (!who) { res.status(401).json({ ok: false, error: 'Your sign-in has expired. Sign in again to keep editing.' }); return; }
    if (b.action === 'check') { res.status(200).json({ ok: true, who }); return; }

    await ensure();
    const target = String(b.id || b.proof_id || b.cal || '');
    let out;
    try { out = await run(b, who); }
    catch (e) { await logSave(who, b.action, target, false, e.message); throw e; }
    await logSave(who, b.action, target, true, b.url || b.title || b.status || b.category || '');
    res.status(200).json(Object.assign({ ok: true }, out));
  } catch (err) {
    if (err.code !== 400) console.error('save:', err);
    res.status(err.code === 400 ? 400 : 500).json({ ok: false, error: String(err.message || err) });
  }
}

async function run(b, who) {
  switch (b.action) {

    /* ---------- Both calendars ---------- */

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
          INSERT INTO events (cal, start_date, end_date, category, title, audience, updated_by)
          VALUES (${calOf(b.cal)}, ${e.start}::date, ${e.end}::date, ${e.category}, ${e.title}, ${e.audience}, ${who})`;
      }
      return readCalendar();
    }

    case 'importEvents': {
      const rows = (Array.isArray(b.rows) ? b.rows : []).map(cleanEvent);
      if (!rows.length) throw new Bad('No entries to add');
      const cal = calOf(b.cal);
      // Titles are matched ignoring case, spaces and punctuation, so "Meeting - All" and
      // "Meeting – All" count as the same entry and importing twice adds nothing. The batch
      // counts too, so the same window for two batches on one date stays as two entries.
      const key = (s, e, t, a) => s + '|' + e + '|' + norm(t) + '|' + norm(a);
      const existing = await q`
        SELECT id::text AS id, to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e,
               title, audience, notes, status, (SELECT count(*) FROM proofs p WHERE p.event_id = events.id)::int AS links
        FROM events WHERE cal = ${cal}`;
      const have = new Map(existing.map(r => [key(r.s, r.e, r.title, r.audience), r]));
      const seen = new Set(), fresh = [];
      for (const r of rows) {
        const k = key(r.start, r.end, r.title, r.audience);
        if (seen.has(k)) continue; seen.add(k);
        if (!have.has(k)) fresh.push(r);
      }
      let removed = 0, kept = 0;
      if (b.replace) {
        // Replace: whatever is not in the file goes, unless someone attached proof,
        // wrote notes or marked it completed.
        const drop = [];
        for (const r of existing) {
          if (seen.has(key(r.s, r.e, r.title, r.audience))) continue;
          if (r.links > 0 || (r.notes || '').trim() || r.status === 'completed') { kept++; continue; }
          drop.push(r.id);
        }
        if (drop.length) {
          await q`DELETE FROM events WHERE id = ANY(${drop}::bigint[])`;
          await q`DELETE FROM proofs WHERE event_id = ANY(${drop}::bigint[])`;
        }
        removed = drop.length;
      }
      if (fresh.length) {
        await q`
          INSERT INTO events (cal, start_date, end_date, category, title, audience, updated_by)
          SELECT ${cal}, s::date, e::date, c, t, a, ${who}
          FROM unnest(${fresh.map(r => r.start)}::text[], ${fresh.map(r => r.end)}::text[],
                      ${fresh.map(r => r.category)}::text[], ${fresh.map(r => r.title)}::text[],
                      ${fresh.map(r => r.audience)}::text[]) AS x(s, e, c, t, a)`;
      }
      return Object.assign({ added: fresh.length, skipped: rows.length - fresh.length, removed, kept }, await readCalendar());
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

    case 'deleteEvent': {
      const id = String(b.id || '');
      if (!/^\d+$/.test(id)) throw new Bad('Unknown activity');
      await q`DELETE FROM proofs WHERE event_id = ${id}::bigint`;
      await q`DELETE FROM events WHERE id = ${id}::bigint`;
      return readCalendar();
    }

    case 'deleteEvents': {
      if (!isDay(b.from) || !isDay(b.to) || b.to < b.from) throw new Bad('Choose a valid date range');
      if (b.confirm !== 'DELETE') throw new Bad('Type DELETE to confirm');
      const keep = b.keepHolidays !== false, cal = calOf(b.cal);
      const gone = keep
        ? await q`DELETE FROM events
                  WHERE cal = ${cal} AND start_date <= ${b.to}::date AND end_date >= ${b.from}::date
                    AND category NOT IN ('holiday', 'observance')
                  RETURNING id`
        : await q`DELETE FROM events
                  WHERE cal = ${cal} AND start_date <= ${b.to}::date AND end_date >= ${b.from}::date
                  RETURNING id`;
      await q`DELETE FROM proofs WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = proofs.event_id)`;
      return Object.assign({ deleted: gone.length }, await readCalendar());
    }

    /* ---------- Batches Status ---------- */

    case 'setBatchCell': {
      const batch = txt(b.batch, 40), prog = txt(b.programme, 80);
      if (!batch || !prog) throw new Bad('Unknown batch or programme');
      const [row] = await q`SELECT admitted, graduated FROM batch_status WHERE batch = ${batch} AND programme = ${prog}`;
      if (!row) throw new Bad('That batch and programme are not in the list');
      const num = v => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new Bad('Enter a whole number of learners, or leave it empty');
        return Math.round(n);
      };
      if (b.field === 'admitted') {
        const v = num(b.value);
        if (v !== null && v < row.graduated) throw new Bad(`There are already ${row.graduated} graduated in this programme, so the learner count cannot be less than that.`);
        await q`UPDATE batch_status SET admitted = ${v}, updated_by = ${who}, updated_at = now() WHERE batch = ${batch} AND programme = ${prog}`;
      } else if (b.field === 'graduated') {
        const v = num(b.value) ?? 0;
        if (row.admitted === null) throw new Bad('This programme had no intake in this batch. Enter the learner count first.');
        if (v > row.admitted) throw new Bad(`Graduated (${v}) is more than the ${row.admitted} learners admitted. Change the learner count first.`);
        await q`UPDATE batch_status SET graduated = ${v}, updated_by = ${who}, updated_at = now() WHERE batch = ${batch} AND programme = ${prog}`;
      } else if (b.field === 'remarks') {
        await q`UPDATE batch_status SET remarks = ${txt(b.value, 500)}, updated_by = ${who}, updated_at = now() WHERE batch = ${batch} AND programme = ${prog}`;
      } else throw new Bad('Unknown field');
      return readBatches();
    }

    case 'addBatch': {
      const batch = txt(b.batch, 40);
      if (!batch) throw new Bad('Give the batch a name, such as Jan-27');
      const [x] = await q`SELECT 1 AS x FROM batch_status WHERE batch = ${batch}`;
      if (x) throw new Bad(batch + ' is already there');
      const progs = await q`SELECT DISTINCT programme, sort_order FROM batch_status ORDER BY sort_order`;
      if (!progs.length) throw new Bad('No programmes to add the batch to');
      await q`
        INSERT INTO batch_status (batch, programme, sort_order, admitted, updated_by)
        SELECT ${batch}, p, o, NULL, ${who}
        FROM unnest(${progs.map(r => r.programme)}::text[], ${progs.map(r => r.sort_order)}::int[]) AS x(p, o)`;
      return readBatches();
    }

    case 'deleteBatch': {
      const batch = txt(b.batch, 40);
      if (b.confirm !== 'DELETE') throw new Bad('Type DELETE to confirm');
      await q`DELETE FROM batch_status WHERE batch = ${batch}`;
      return readBatches();
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
