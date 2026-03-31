import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Serve static frontend ---
app.use(express.static(join(__dirname, "public")));

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ============================================================
// POST /api/jobs  –  Scrape LinkedIn jobs via Apify
// ============================================================
app.post("/api/jobs", async (req, res) => {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  if (!APIFY_TOKEN) {
    return res.status(500).json({ error: "Missing APIFY_TOKEN" });
  }

  // Accept optional search params from frontend
  const { keywords, location, jobCount } = req.body || {};
  const searchKeywords = keywords || "financial analyst";
  const searchLocation = location || "Toronto, Ontario, Canada";
  const count = jobCount || 20;

  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchKeywords)}&location=${encodeURIComponent(searchLocation)}`;

  try {
    const response = await fetch(
      `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: [searchUrl],
          scrapeCompanyDetails: false,
          jobCount: count,
        }),
      }
    );

    const text = await response.text();

    if (!response.ok) {
      return res.status(500).json({
        error: "Apify request failed",
        status: response.status,
        body: text,
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: "Invalid JSON from Apify", body: text });
    }

    const jobs = data.map((item, i) => ({
      id: item.id || `job-${i}`,
      title: item.title || "Untitled",
      company: item.companyName || item.company || "Unknown",
      location: item.location || "N/A",
      type: item.employmentType || item.type || "Full-time",
      url: item.link || item.url || "",
      description: item.description || "",
      tags: item.tags || [],
      postedAt: item.postedAt || item.publishedAt || "",
      salary: item.salary || "",
    }));

    return res.json(jobs);
  } catch (err) {
    console.error("Jobs endpoint error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/analyze  –  Score jobs against resume via Claude
// ============================================================
app.post("/api/analyze", async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });
  }

  try {
    const { resume, jobs } = req.body;

    const jobList = jobs
      .map(
        (j) =>
          `ID:${j.id} | ${j.title} at ${j.company} | ${j.location} | ${j.type} | Tags: ${(j.tags || []).join(", ")}`
      )
      .join("\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `You are a career advisor AI. Given this resume and job listings, score each job 0-100 for fit and give a 1-sentence reason.

Resume:
${resume}

Jobs:
${jobList}

Respond ONLY with valid JSON — no markdown, no backticks. Format:
[{"id":"...","score":80,"reason":"..."},...]`,
          },
        ],
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Claude API error:", result);
      return res.status(500).json({ error: "Claude API request failed", details: result });
    }

    const text = result.content?.[0]?.text || "[]";
    const clean = text.replace(/```json|```/g, "").trim();

    let scores;
    try {
      scores = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: "Failed to parse Claude response", raw: text });
    }

    return res.json(scores);
  } catch (err) {
    console.error("Analyze endpoint error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- SPA fallback ---
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Danyal Job Matcher running on port ${PORT}`);
});
