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
// POST /api/jobs  –  Search Indeed jobs via Claude + MCP
// ============================================================
app.post("/api/jobs", async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });
  }

  const { keywords, location, jobType } = req.body || {};
  const searchKeywords = keywords || "financial analyst";
  const searchLocation = location || "Toronto, Ontario";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
          },
        ],
        mcp_servers: [
          {
            type: "url",
            url: "https://mcp.indeed.com/claude/mcp",
            name: "indeed-mcp",
          },
        ],
        messages: [
          {
            role: "user",
            content: `Search for "${searchKeywords}" jobs in "${searchLocation}" on Indeed (country code: CA)${jobType ? `, job type: ${jobType}` : ""}.

Return ONLY valid JSON — no markdown, no backticks, no explanation. Format:
[
  {
    "id": "the_job_id",
    "title": "Job Title",
    "company": "Company Name",
    "location": "City, Province",
    "type": "Full-time or Contract or Internship or Part-time or Temporary",
    "url": "the apply URL from results",
    "salary": "salary if available or empty string",
    "postedAt": "posted date if available or empty string"
  }
]

Return every job from the search results. Only return the JSON array, nothing else.`,
          },
        ],
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Claude API error:", JSON.stringify(result));
      return res.status(500).json({ error: "Claude API request failed", details: result });
    }

    // Extract text from Claude's response (may have multiple content blocks)
    const textBlocks = (result.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text);

    const fullText = textBlocks.join("\n");

    // Try to parse JSON from the response
    let jobs = [];
    try {
      const clean = fullText.replace(/```json|```/g, "").trim();
      jobs = JSON.parse(clean);
    } catch {
      // Try to find JSON array in the text
      const match = fullText.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          jobs = JSON.parse(match[0]);
        } catch {
          console.error("Could not parse jobs from response:", fullText);
          return res.status(500).json({ error: "Failed to parse job results", raw: fullText });
        }
      } else {
        console.error("No JSON array found in response:", fullText);
        return res.status(500).json({ error: "No job results found", raw: fullText });
      }
    }

    // Normalize
    jobs = jobs.map((j, i) => ({
      id: j.id || `job-${i}`,
      title: j.title || "Untitled",
      company: j.company || "Unknown",
      location: j.location || "N/A",
      type: j.type || "Full-time",
      url: j.url || "",
      salary: j.salary || "",
      postedAt: j.postedAt || "",
      description: j.description || "",
      tags: j.tags || [],
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
