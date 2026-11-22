# TruthLens — Gemini-powered media assessment showcase

A polished, responsive single-page showcase for image and video **visual authenticity assessments**. It uses Gemini's multimodal API as a *heuristic visual assessor*, not the previously trained TruthLens PyTorch model.

## Important limitations

Gemini is **not a validated deepfake detector**. The result is a subjective model assessment and the 0–100 display is not a calibrated probability of authenticity. `UNCERTAIN` is an intended result. Video mode evaluates **four sampled still frames**, not full motion/audio. Do not use for allegations or consequential decisions.

## Deploy to Vercel (free Hobby plan, within quotas)

1. Create a Google AI Studio API key: https://aistudio.google.com/apikey
2. Upload this folder to a new **private GitHub repository**. Do not commit your real API key.
3. In https://vercel.com/new import that GitHub repository.
4. Framework preset: **Other**. Root directory: project root. No build command is needed. (The project uses static HTML/CSS/JS plus a Node.js serverless function.)
5. In Vercel project settings **Environment Variables**, add:
   - `GEMINI_API_KEY` = your secret key
   - `GEMINI_MODEL` = `gemini-2.5-flash` (optional, must be a supported multimodal model for your key)
6. Deploy (or redeploy after entering variables). Open your `*.vercel.app` URL.
7. Upload an image. Then try a small MP4 video. Check the actual output and API quotas.

## Local testing

- Install Node.js 20 or newer.
- `npm install -g vercel`
- `vercel login`
- `vercel link`
- `vercel env pull .env.local` to fetch the project's environment configuration, or set `GEMINI_API_KEY` in `.env.local` manually.
- `vercel dev`
- Open the displayed localhost URL. Opening `index.html` directly as a file won't run `/api/analyze`.

## Architecture

- `index.html`, `style.css`, `app.js`: responsive browser interface.
- `app.js`: file selection/preview, resizing an image or extracting 4 video frames in the browser, then POST to `/api/analyze`.
- `api/analyze.js`: backend serverless API. API key stays on server, validates media input, sends images to Gemini and sanitizes model response.
- `vercel.json`: serverless function configuration.

## Free usage cautions

- Vercel Hobby plan and Gemini API free tier have rate and usage quotas. Availability depends on account, country, chosen model and current pricing.
- Browser samples videos into JPEG frames to keep the backend request under Vercel's typical ~4.5 MB default payload limit. Files never travel to this server as original binaries; only reduced visual frames are sent to Gemini.
- The included in-memory rate limit is best-effort per running function instance, not a robust production anti-abuse mechanism. A public URL may exhaust your Gemini API quota. For production add edge rate limiting, access control, quota alerts and abuse protection.
- For better safety and predictability, disable public access or add proper authentication after the evaluation.
- Before demo, run tests on known real and AI-generated examples: don't present heuristic scores as measured accuracy.

## Security

Never paste your API key into `index.html` or `app.js`. Use Vercel Environment Variables. Revoke a key if it has been published. No account or storage backend is implemented.
