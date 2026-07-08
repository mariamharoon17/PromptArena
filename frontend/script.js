let chartTime   = null;
let chartTokens = null;
let chartRadar  = null;

const MODEL_LABELS = ["ChatGPT", "Claude", "Gemini"];
const MODEL_KEYS   = ["openai", "claude", "gemini"];

const COLORS = {
  openai: { bar: "#10A37F", border: "#0D8A6D" },
  claude: { bar: "#D97757", border: "#B85E3E" },
  gemini: { bar: "#4285F4", border: "#2A6DD9" },
};

// ── Enter key fix ────────────────────────────────────────
window.addEventListener("load", function() {
  const promptBox = document.getElementById("prompt");
  if (promptBox) {
    promptBox.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        runBenchmark();
      }
    });
  }
});

// ── Auto Scoring Engine ──────────────────────────────────
function autoScore(response, prompt) {
  if (!response || response.includes("coming soon") || response.includes("Error")) {
    return { correctness: 0, completeness: 0, clarity: 0, errorRate: 0, overall: 0 };
  }
  const text     = response.toLowerCase();
  const words    = response.split(/\s+/).filter(Boolean);
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 2);
  const promptWords = prompt.split(/\s+/).length;

  const hasCode = response.includes("```") || response.includes("def ") ||
                  response.includes("function") || response.includes("SELECT") ||
                  response.includes("<html") || response.includes("const ");
  const errorKeywords = ["syntax error","undefined","null pointer","traceback",
                         "exception","cannot read","is not defined","error:"];
  const hasErrors  = errorKeywords.some(k => text.includes(k));
  const codeScore  = hasCode ? (hasErrors ? 40 : 90) : (hasErrors ? 20 : 70);

  const expectedLength = Math.max(100, promptWords * 15);
  const completeness   = Math.min(100, Math.round((words.length / expectedLength) * 100));

  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0;
  const hasStructure = response.includes("\n") || response.includes("•") ||
                       response.includes("-")  || response.includes("1.");
  let clarityScore = 60;
  if (avgWordsPerSentence >= 8 && avgWordsPerSentence <= 25) clarityScore += 20;
  if (hasStructure) clarityScore += 15;
  if (words.length > 50) clarityScore += 5;
  clarityScore = Math.min(100, clarityScore);

  const negativePatterns = ["i cannot","i can't","i don't know","i'm unable",
                             "not possible","unfortunately","i apologize"];
  const hasNegative = negativePatterns.some(k => text.includes(k));
  const errorRate   = hasNegative ? 40 : (hasErrors ? 30 : 95);

  const overall = Math.round(
    (codeScore * 0.35) + (completeness * 0.25) + (clarityScore * 0.25) + (errorRate * 0.15)
  );

  return {
    correctness:  codeScore,
    completeness: Math.min(100, completeness),
    clarity:      clarityScore,
    errorRate:    errorRate,
    overall:      overall
  };
}

// ── Run Benchmark ────────────────────────────────────────
async function runBenchmark() {
  const prompt   = document.getElementById("prompt").value.trim();
  const category = document.getElementById("category").value;

  if (!prompt) { alert("Please enter a prompt first!"); return; }

  document.getElementById("loading").style.display = "block";
  document.getElementById("results").style.display  = "none";
  document.getElementById("runBtn").disabled = true;

  try {
    const res = await fetch(`${BACKEND}/benchmark`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        prompt,
        category,
        project_id: typeof activeProjectId !== "undefined" ? activeProjectId : null
      })
    });
    const data = await res.json();
    displayResults(data, prompt);
  } catch (err) {
    alert("Cannot reach backend! Make sure Flask is running: python app.py");
    console.error(err);
  } finally {
    document.getElementById("loading").style.display = "none";
    document.getElementById("runBtn").disabled = false;
  }
}

// ── Display Results ──────────────────────────────────────
function displayResults(data, prompt) {
  const scores = {};
  MODEL_KEYS.forEach(ai => {
    scores[ai] = autoScore(data[ai].response, prompt);
  });

  MODEL_KEYS.forEach(ai => {
    const r = data[ai];
    const respEl = document.getElementById(`resp-${ai}`);
    const metaEl = document.getElementById(`meta-${ai}`);

    if (!respEl) return;

    if (r.error) {
  respEl.textContent = `Error: ${r.error}`;
} else if (r.response) {
  respEl.innerHTML = marked.parse(r.response);
} else {
  respEl.textContent = "No response";
}
    respEl.style.color     = r.unavailable ? "#a09080" : "#3a2e1e";
    respEl.style.fontStyle = r.unavailable ? "italic"  : "normal";

    if (metaEl && !r.error && !r.unavailable) {
      metaEl.innerHTML =
        `Time: <span>${r.time_ms}ms</span> &nbsp;
         Tokens: <span>${r.tokens || "N/A"}</span> &nbsp;
         Score: <span>${scores[ai].overall}/100</span>`;
    }
  });

  const times   = { openai: data.openai.time_ms, claude: data.claude.time_ms, gemini: data.gemini.time_ms };
  const overall = { openai: scores.openai.overall, claude: scores.claude.overall, gemini: scores.gemini.overall };

  const fastest   = MODEL_KEYS.filter(k => times[k] > 0)
                               .reduce((a, b) => times[a] < times[b] ? a : b);
  const bestScore = MODEL_KEYS.reduce((a, b) => overall[a] > overall[b] ? a : b);

  MODEL_KEYS.forEach(ai => {
    const badge = document.getElementById(`badge-${ai}`);
    if (!badge) return;
    if (ai === bestScore) {
      badge.textContent = "Best Score";
      badge.classList.add("visible");
    } else if (ai === fastest) {
      badge.textContent = "Fastest";
      badge.classList.add("visible");
    } else {
      badge.classList.remove("visible");
    }
  });

  const tbody = document.getElementById("scoreBody");
  if (tbody) {
    tbody.innerHTML = "";
    const rows = [
      { metric: "Response Time (ms)",      values: times,  lower: true  },
      { metric: "Token Usage",             values: { openai: data.openai.tokens, claude: data.claude.tokens, gemini: data.gemini.tokens }, lower: true },
      { metric: "Code Correctness (/100)", values: { openai: scores.openai.correctness, claude: scores.claude.correctness, gemini: scores.gemini.correctness }, lower: false },
      { metric: "Completeness (/100)",     values: { openai: scores.openai.completeness, claude: scores.claude.completeness, gemini: scores.gemini.completeness }, lower: false },
      { metric: "Clarity (/100)",          values: { openai: scores.openai.clarity, claude: scores.claude.clarity, gemini: scores.gemini.clarity }, lower: false },
      { metric: "Error Rate (/100)",       values: { openai: scores.openai.errorRate, claude: scores.claude.errorRate, gemini: scores.gemini.errorRate }, lower: false },
      { metric: "Overall Score (/100)",    values: overall, lower: false },
    ];

    rows.forEach(row => {
      const valid  = MODEL_KEYS.filter(k => row.values[k] > 0);
      const winner = valid.length
        ? valid.reduce((a, b) => row.lower
            ? row.values[a] < row.values[b] ? a : b
            : row.values[a] > row.values[b] ? a : b)
        : null;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.metric}</td>` +
        MODEL_KEYS.map(ai =>
          `<td class="${winner === ai ? 'winner' : ''}">${row.values[ai] || "N/A"}</td>`
        ).join("");
      tbody.appendChild(tr);
    });
  }

  renderCharts(data, scores);

  const resultsEl = document.getElementById("results");
  if (resultsEl) {
    resultsEl.style.display = "block";
    setTimeout(() => resultsEl.scrollIntoView({ behavior: "smooth" }), 100);
  }
}

// ── Charts ───────────────────────────────────────────────
function renderCharts(data, scores) {
  const chartDefaults = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1a1008",
        titleColor: "#faf8f4",
        bodyColor: "#d4c9b8",
        padding: 12,
        cornerRadius: 8,
      }
    }
  };

  const barScales = {
    x: {
      grid: { color: "#d4c9b820" },
      ticks: { color: "#7a6a58", font: { family: "'Inter', sans-serif", size: 11 } }
    },
    y: {
      grid: { color: "#d4c9b840" },
      ticks: { color: "#7a6a58", font: { family: "'Inter', sans-serif", size: 11 } }
    }
  };

  const timeValues = MODEL_KEYS.map(k => data[k].time_ms || 0);
  if (chartTime) chartTime.destroy();
  chartTime = new Chart(document.getElementById("chartTime"), {
    type: "bar",
    data: {
      labels: MODEL_LABELS,
      datasets: [{
        data: timeValues,
        backgroundColor: MODEL_KEYS.map(k => COLORS[k].bar + "cc"),
        borderColor:     MODEL_KEYS.map(k => COLORS[k].border),
        borderWidth: 1.5,
        borderRadius: 8,
      }]
    },
    options: {
      ...chartDefaults,
      scales: { ...barScales, y: { ...barScales.y, title: { display: true, text: "ms", color: "#7a6a58" } } }
    }
  });

  const overallValues = MODEL_KEYS.map(k => scores[k].overall);
  if (chartTokens) chartTokens.destroy();
  chartTokens = new Chart(document.getElementById("chartTokens"), {
    type: "bar",
    data: {
      labels: MODEL_LABELS,
      datasets: [{
        data: overallValues,
        backgroundColor: MODEL_KEYS.map(k => COLORS[k].bar + "cc"),
        borderColor:     MODEL_KEYS.map(k => COLORS[k].border),
        borderWidth: 1.5,
        borderRadius: 8,
      }]
    },
    options: {
      ...chartDefaults,
      scales: { ...barScales, y: { ...barScales.y, min: 0, max: 100, title: { display: true, text: "score", color: "#7a6a58" } } }
    }
  });

  const metricLabels = ["Correctness", "Completeness", "Clarity", "Error-Free"];
  const metricKeys   = ["correctness", "completeness", "clarity", "errorRate"];

  if (chartRadar) chartRadar.destroy();
  chartRadar = new Chart(document.getElementById("chartRadar"), {
    type: "bar",
    data: {
      labels: metricLabels,
      datasets: MODEL_KEYS.map(k => ({
        label: k === "openai" ? "ChatGPT" : k === "claude" ? "Claude" : "Gemini",
        data:  metricKeys.map(m => scores[k][m]),
        backgroundColor: COLORS[k].bar + "cc",
        borderColor:     COLORS[k].border,
        borderWidth: 1.5,
        borderRadius: 6,
      }))
    },
    options: {
      responsive: true,
      indexAxis: "y",
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: "#1a1008",
            font: { family: "'Inter', sans-serif", size: 11 },
            padding: 20,
            usePointStyle: true,
          }
        },
        tooltip: {
          backgroundColor: "#1a1008",
          titleColor: "#faf8f4",
          bodyColor:  "#d4c9b8",
          padding: 12,
          cornerRadius: 8,
        }
      },
      scales: {
        x: {
          min: 0, max: 100,
          grid:  { color: "#d4c9b840" },
          ticks: { color: "#7a6a58", font: { family: "'Inter', sans-serif", size: 11 } },
          title: { display: true, text: "Score /100", color: "#7a6a58" }
        },
        y: {
          grid:  { display: false },
          ticks: { color: "#1a1008", font: { family: "'Inter', sans-serif", size: 12, weight: "500" } }
        }
      }
    }
  });
}

// ── Category-specific placeholder ─────────────────────────
const PLACEHOLDERS = {
  "Funding Research": "e.g. List UK charitable trusts that fund engineering activities at universities. Present in a table with funder name, grant size, eligibility and deadlines...",
  "General":  "e.g. Explain how photosynthesis works in simple terms...",
  "Coding":   "e.g. Write a Python function to check if a string is a palindrome...",
  "Database": "e.g. Write an SQL query to find the second highest salary from an Employees table...",
  "Website":  "e.g. Create an HTML and CSS card component with an image, title and button...",
  "Creative": "e.g. Write a short poem about the changing seasons...",
  "Reasoning": "e.g. If a train travels 60 km in 45 minutes, what is its speed in km/h?...",
};

function updatePlaceholder() {
  const category = document.getElementById("category").value;
  const promptBox = document.getElementById("prompt");
  if (promptBox && PLACEHOLDERS[category]) {
    promptBox.placeholder = PLACEHOLDERS[category];
  }
}

// Set the correct placeholder on page load
window.addEventListener("load", updatePlaceholder);