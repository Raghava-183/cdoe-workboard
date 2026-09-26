import { ensure, readCalendar, readDay, readCounts, readRange, readFaculty } from './_db.js';

const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Use GET' }); return; }
  const { what, date, from, to } = req.query || {};
  try {
    await ensure();
    let data;
    if (what === 'calendar') data = await readCalendar();
    else if (what === 'faculty') data = { faculty: await readFaculty(true) };
    else if (what === 'day') {
      if (!isDay(date)) throw Object.assign(new Error('A valid date is needed'), { code: 400 });
      data = await readDay(date);
    } else if (what === 'counts' || what === 'range') {
      if (!isDay(from) || !isDay(to) || to < from) throw Object.assign(new Error('A valid date range is needed'), { code: 400 });
      data = what === 'counts' ? await readCounts(from, to) : await readRange(from, to);
    } else throw Object.assign(new Error('Unknown request'), { code: 400 });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(Object.assign({ ok: true }, data));
  } catch (err) {
    if (err.code !== 400) console.error('read:', err);
    res.status(err.code === 400 ? 400 : 500).json({ ok: false, error: String(err.message || err) });
  }
}
