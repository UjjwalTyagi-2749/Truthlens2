const MAX_BODY = 4_200_000;
const RATE = new Map();
const WINDOW = 60_000;
const MAX_PER_MINUTE = 6;

function fail(res, status, error) { return res.status(status).json({ error }); }
function cleanJson(input) {
  const s = input.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) throw new Error('Invalid model response'); return JSON.parse(s.slice(a, b + 1)); }
}
function sanitizeDataUrl(value) {
  if (typeof value !== 'string') return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(value);
  if (!m) return null;
  if (m[2].length > 1_800_000) return null;
  return { inline_data: { mime_type: `image/${m[1]}`, data: m[2] } };
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return fail(res, 405, 'POST required.');
  if (!process.env.GEMINI_API_KEY) return fail(res, 503, 'Server not configured. Add GEMINI_API_KEY in Vercel environment variables.');
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
  const now = Date.now();
  const existing = RATE.get(ip) || [];
  const fresh = existing.filter(t => now - t < WINDOW);
  if (fresh.length >= MAX_PER_MINUTE) return fail(res, 429, 'Too many requests. Try again in a minute.');
  fresh.push(now); RATE.set(ip, fresh);
  try {
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) return fail(res, 413, 'Media payload is too large. Try a smaller image or video.');
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const mode = body?.mode;
    const frames = body?.frames;
    if (!['image', 'video'].includes(mode) || !Array.isArray(frames)) return fail(res, 400, 'Invalid media payload.');
    if (frames.length < 1 || frames.length > (mode === 'video' ? 4 : 1)) return fail(res, 400, 'Invalid number of frames.');
    const parts = [];
    for (const frame of frames) {
      const part = sanitizeDataUrl(frame);
      if (!part) return fail(res, 400, 'Invalid or oversized image frame.');
      parts.push(part);
    }
    const prompt = `You are analyzing ${mode === 'image' ? 'a single image' : 'four or fewer frames sampled from a video'} to look for visible indicators of AI synthesis or manipulation. The task is forensic visual assessment, not face identification, and you have no access to source metadata or ground truth. Do NOT claim you can reliably prove real or fake. Distinguish artifacts from ordinary compression, blur, lighting, or low resolution. If the evidence is inadequate or ambiguous choose UNCERTAIN. State specific visible observations, not imaginary details. For video frames, note that temporal continuity cannot be fully verified from samples. Return strict JSON ONLY with this shape: {"verdict":"LIKELY_AI"|"LIKELY_REAL"|"UNCERTAIN","score":integer from 0 to 100 representing the heuristic strength of the assessment NOT a probability or calibrated confidence,"summary":string max 220 characters,"signals":[up to 4 short grounded observations],"limitations":string max 220 characters}. Avoid definitively accusing a real person or identifying faces.`;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);
    let response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }, ...parts] }],
          generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 700 }
        })
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      let problem = await response.json().catch(() => ({}));
      let status = response.status === 429 ? 429 : response.status === 400 ? 400 : 502;
      return fail(res, status, status === 429 ? 'Gemini free-tier quota reached. Try again later.' : `Gemini request failed (${response.status}). Check your key, model and quota.`);
    }
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!raw) return fail(res, 502, 'Gemini returned no analysis. Try another file.');
    const out = cleanJson(raw);
    const verdict = ['LIKELY_AI', 'LIKELY_REAL', 'UNCERTAIN'].includes(out.verdict) ? out.verdict : 'UNCERTAIN';
    const score = Math.max(0, Math.min(100, Number.isFinite(+out.score) ? Math.round(+out.score) : 0));
    const trim = (x, n) => typeof x === 'string' ? x.slice(0,n) : '';
    return res.status(200).json({ verdict, score, summary: trim(out.summary, 240), signals: Array.isArray(out.signals) ? out.signals.filter(x => typeof x === 'string').slice(0,4).map(x => x.slice(0,140)) : [], limitations: trim(out.limitations, 240), model, note: 'Gemini visual assessment only. This score is not calibrated confidence or proof of authenticity.' });
  } catch (err) {
    return fail(res, 500, err?.name === 'AbortError' ? 'Analysis timed out. Try a smaller file.' : 'Unable to analyze this file. Please try another.');
  }
}
