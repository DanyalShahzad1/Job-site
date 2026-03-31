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
app.use(express.json({ limit: "2mb" }));

// --- Serve static frontend ---
app.use(express.static(join(__dirname, "public")));

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ============================================================
// POST /api/jobs  –  Search jobs via SerpAPI (Google Jobs)
// ============================================================
app.post("/api/jobs", async (req, res) => {
  const SERPAPI_KEY = process.env.SERPAPI_KEY;

  if (!SERPAPI_KEY) {
    return res.status(500).json({ error: "Missing SERPAPI_KEY" });
  }

  const { keywords, location } = req.body || {};
  const searchKeywords = keywords || "financial analyst";
  const searchLocation = location || "Toronto, Ontario, Canada";

  try {
    const query = encodeURIComponent(`${searchKeywords} jobs in ${searchLocation}`);
    const url = `https://serpapi.com/search.json?engine=google_jobs&q=${query}&hl=en&api_key=${SERPAPI_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
      console.error("SerpAPI error:", data);
      return res.status(500).json({ error: data.error || "SerpAPI request failed" });
    }

    const jobResults = data.jobs_results || [];

    const jobs = jobResults.map((item, i) => {
      // Determine job type
      let type = "Full-time";
      if (item.detected_extensions) {
        const ext = item.detected_extensions;
        if (ext.schedule_type) {
          type = ext.schedule_type;
        }
      }

      // Get salary
      let salary = "";
      if (item.detected_extensions && item.detected_extensions.salary) {
        salary = item.detected_extensions.salary;
      }

      // Get posted time
      let postedAt = "";
      if (item.detected_extensions && item.detected_extensions.posted_at) {
        postedAt = item.detected_extensions.posted_at;
      }

      // Get apply link
      let url = "";
      if (item.apply_options && item.apply_options.length > 0) {
        url = item.apply_options[0].link || "";
      } else if (item.share_link) {
        url = item.share_link;
      }

      return {
        id: item.job_id || `job-${i}`,
        title: item.title || "Untitled",
        company: item.company_name || "Unknown",
        location: item.location || "N/A",
        type: type,
        url: url,
        salary: salary,
        postedAt: postedAt,
        description: item.description || "",
        tags: item.job_highlights
          ? item.job_highlights.flatMap((h) => h.items || []).slice(0, 5)
          : [],
      };
    });

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
          `ID:${j.id} | ${j.title} at ${j.company} | ${j.location} | ${j.type} | Salary: ${j.salary || "N/A"}`
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
        max_tokens: 2000,
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
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) {
        scores = JSON.parse(match[0]);
      } else {
        return res.status(500).json({ error: "Failed to parse Claude response", raw: text });
      }
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
