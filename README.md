# Danyal Job Match Engine

A full-stack job matching app that scrapes LinkedIn jobs via Apify and scores them against your resume using Claude AI.

## Stack
- **Backend:** Express.js (serves API + static frontend)
- **Frontend:** React (via CDN, no build step)
- **Scraping:** Apify LinkedIn Jobs Scraper
- **AI:** Claude Sonnet (Anthropic API)
- **Hosting:** Railway

## Deploy to Railway

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   gh repo create danyal-job-matcher --private --push
   ```

2. **Go to [railway.app](https://railway.app)** → New Project → Deploy from GitHub repo

3. **Add environment variables** in Railway dashboard → Variables:
   - `APIFY_TOKEN` — your Apify API token
   - `ANTHROPIC_API_KEY` — your Anthropic API key

4. Railway auto-detects Node.js and runs `npm start`. Done!

## Local Development

```bash
cp .env.example .env   # fill in your keys
npm install
npm run dev            # http://localhost:3001
```

## How It Works

1. Enter job keywords + location → **Scrape Jobs** calls Apify to pull listings from LinkedIn
2. Click **AI Match** → sends your resume + job data to Claude, which scores each job 0-100
3. Filter and sort by match score, job type, etc.
4. Click any card to expand and see the AI's reasoning + job description
