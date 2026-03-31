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
app.use(express.json({ limit: "5mb" }));

// --- Serve static frontend ---
app.use(express.static(join(__dirname, "public")));

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ============================================================
// Helper: fetch one page of Google Jobs from SerpAPI
// ============================================================
async function fetchJobsPage(query, apiKey, nextPageToken = null) {
  let url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(query)}&hl=en&api_key=${apiKey}`;
  if (nextPageToken) {
    url += `&next_page_token=${encodeURIComponent(nextPageToken)}`;
  }
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || "SerpAPI request failed");
  }

  return {
    jobs: data.jobs_results || [],
    nextToken: data.serpapi_pagination?.next_page_token || null,
  };
}

// ============================================================
// POST /api/jobs  –  Search jobs via SerpAPI (up to 50)
// ============================================================
app.post("/api/jobs", async (req, res) => {
  const SERPAPI_KEY = process.env.SERPAPI_KEY;

  if (!SERPAPI_KEY) {
    return res.status(500).json({ error: "Missing SERPAPI_KEY" });
  }

  const { keywords, location } = req.body || {};
  const searchKeywords = keywords || "financial analyst";
  const searchLocation = location || "Toronto, Ontario, Canada";
  const query = `${searchKeywords} jobs in ${searchLocation}`;

  try {
    const allResults = [];
    let nextToken = null;
    const maxPages = 5; // up to 5 pages for ~50 jobs

    for (let page = 0; page < maxPages; page++) {
      try {
        const { jobs, nextToken: token } = await fetchJobsPage(query, SERPAPI_KEY, nextToken);
        if (jobs.length === 0) break;
        allResults.push(...jobs);
        nextToken = token;
        if (!nextToken) break; // no more pages
      } catch (pageErr) {
        console.error(`Error fetching page ${page + 1}:`, pageErr.message);
        if (allResults.length > 0) break;
        throw pageErr;
      }
    }

    const jobs = allResults.slice(0, 50).map((item, i) => {
      let type = "Full-time";
      let salary = "";
      let postedAt = "";

      if (item.detected_extensions) {
        const ext = item.detected_extensions;
        if (ext.schedule_type) type = ext.schedule_type;
        if (ext.salary) salary = ext.salary;
        if (ext.posted_at) postedAt = ext.posted_at;
      }

      let applyUrl = "";
      if (item.apply_options && item.apply_options.length > 0) {
        applyUrl = item.apply_options[0].link || "";
      } else if (item.share_link) {
        applyUrl = item.share_link;
      }

      const tags = item.job_highlights
        ? item.job_highlights.flatMap((h) => h.items || []).slice(0, 5)
        : [];

      return {
        id: item.job_id || `job-${i}`,
        title: item.title || "Untitled",
        company: item.company_name || "Unknown",
        location: item.location || "N/A",
        type,
        url: applyUrl,
        salary,
        postedAt,
        description: item.description || "",
        tags,
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

    if (!resume || !resume.trim()) {
      return res.status(400).json({ error: "Please upload or paste your resume first" });
    }

    // Split jobs into batches of 15 to avoid token limits
    const batchSize = 15;
    const batches = [];
    for (let i = 0; i < jobs.length; i += batchSize) {
      batches.push(jobs.slice(i, i + batchSize));
    }

    let allScores = [];

    for (const batch of batches) {
      const jobList = batch
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
          max_tokens: 3000,
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
        continue;
      }

      const text = result.content?.[0]?.text || "[]";
      const clean = text.replace(/```json|```/g, "").trim();

      try {
        const batchScores = JSON.parse(clean);
        allScores.push(...batchScores);
      } catch {
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            const batchScores = JSON.parse(match[0]);
            allScores.push(...batchScores);
          } catch {
            console.error("Failed to parse batch response:", clean);
          }
        }
      }
    }

    return res.json(allScores);
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
