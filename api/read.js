import { q, ensure, readCalendar, dbInfo } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Use GET' }); return; }
  const { what } = req.query || {};
  try {
    await ensure();
    let data;
    if (what === 'calendar') data = await readCalendar();
    else if (what === 'health') {
      const [c] = await q`SELECT (SELECT count(*) FROM events WHERE cal = 'activity')::int AS activity_events,
                                 (SELECT count(*) FROM events WHERE cal = 'coe')::int AS coe_events,
                                 (SELECT count(*) FROM proofs)::int AS proofs,
                                 current_database() AS database, now() AS server_time`;
      const log = await q`SELECT to_char(at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI:SS') AS at, who, action, target, ok, detail
                          FROM audit ORDER BY id DESC LIMIT 25`;
      data = { server: dbInfo(), counts: c, recentSaves: log };
    } else throw Object.assign(new Error('Unknown request'), { code: 400 });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(Object.assign({ ok: true }, data));
  } catch (err) {
    if (err.code !== 400) console.error('read:', err);
    res.status(err.code === 400 ? 400 : 500).json({ ok: false, error: String(err.message || err) });
  }
}
