let chartRule = null, chartJudge = null, chartTime = null;

const MODEL_LABELS = ["ChatGPT", "Claude", "Gemini"];
const MODEL_KEYS   = ["openai", "claude", "gemini"];
const MODEL_NAME   = { openai: "ChatGPT", claude: "Claude", gemini: "Gemini" };

const COLORS = {
  openai: { bar: "#12866b", border: "#0d6d57" },
  claude: { bar: "#c2612f", border: "#a24d24" },
  gemini: { bar: "#3c6bb5", border: "#2d5495" },
};

const PLACEHOLDERS = {
  "General":   "Ask anything: a question, an explanation, a comparison, a piece of writing. e.g. Explain the difference between SQL and NoSQL databases...",
  "Funding Research": "e.g. List UK charitable trusts that fund engineering activities at universities. Present in a table with funder name, grant size, eligibility and deadlines...",
  "Database":  "e.g. Write an SQL query to find the second highest salary from an Employees table...",
  "Creative":  "e.g. Write a short poem about the changing seasons...",
  "Reasoning": "e.g. If a train travels 60 km in 45 minutes, what is its speed in km/h?...",
  // still used by the Build and Code Assist pages
  "Website":   "e.g. Create an HTML and CSS card component with an image, title and button...",
  "Coding":    "e.g. Write a Python function to check if a string is a palindrome...",
};

function updatePlaceholder() {
  const sel = document.getElementById("category");
  const promptBox = document.getElementById("prompt");
  if (!sel || !promptBox) return;
  if (PLACEHOLDERS[sel.value]) promptBox.placeholder = PLACEHOLDERS[sel.value];
}

window.addEventListener("load", function () {
  updatePlaceholder();
  const promptBox = document.getElementById("prompt");
  if (promptBox) {
    promptBox.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        if (typeof runBenchmark === "function") runBenchmark();
      }
    });
  }
});

function toggleTables() {
  const wrap = document.getElementById("tablesWrap");
  const btn  = document.getElementById("tablesToggle");
  if (!wrap || !btn) return;
  const open = wrap.style.display !== "none";
  wrap.style.display = open ? "none" : "block";
  btn.textContent = open ? "Show tables" : "Hide tables";
}

/* kept for backwards compatibility with older pages */
function toggleScoringInfo() { toggleTables(); }
function toggleLLMInfo()     { toggleTables(); }
function ensureLLMSection()  { return document.getElementById("scoreBodyLLM"); }

// ── Judge values ─────────────────────────────────────────
// The backend has used a few different key names for the judge rubric over
// time. Read whichever one is present so the tables and the chart never end up
// blank while the data is actually there.
const JUDGE_KEYS = {
  substance:    ["substance", "correctness", "accuracy"],
  completeness: ["completeness", "coverage"],
  clarity:      ["clarity", "readability"],
  reliability:  ["reliability", "errorRate", "error_rate", "safety"],
  overall:      ["overall", "score", "total"]
};

function judgeMetric(llmObj, metric) {
  if (!llmObj) return 0;
  const names = JUDGE_KEYS[metric] || [metric];
  for (const n of names) {
    const v = llmObj[n];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  }
  return 0;
}

function judgeValsFrom(data) {
  const llm = {};
  MODEL_KEYS.forEach(k => { llm[k] = (data[k] && data[k].llm) ? data[k].llm : null; });
  return (metric) => ({
    openai: judgeMetric(llm.openai, metric),
    claude: judgeMetric(llm.claude, metric),
    gemini: judgeMetric(llm.gemini, metric)
  });
}

// ── Score table rows (winner highlighted) ─────────────────
function fillScoreRows(tbody, rows) {
  tbody.innerHTML = "";
  rows.forEach(row => {
    const valid = MODEL_KEYS.filter(k => row.values[k] > 0);
    const winner = valid.length
      ? valid.reduce((a, b) => row.lower
          ? (row.values[a] < row.values[b] ? a : b)
          : (row.values[a] > row.values[b] ? a : b))
      : null;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.metric}</td>` +
      MODEL_KEYS.map(ai => {
        const v = row.values[ai];
        const shown = (v === undefined || v === null) ? "N/A" : v;
        return `<td class="${winner === ai ? "winner" : ""}">${shown}</td>`;
      }).join("");
    tbody.appendChild(tr);
  });
}

// ── Auto Scoring Engine (unchanged from v1) ──────────────
function autoScore(response, prompt) {
  const zeros = { correctness:0, completeness:0, clarity:0, errorRate:0, overall:0 };
  if (!response || typeof response !== "string") return zeros;
  if (response.trim() === "" || response.toLowerCase().includes("coming soon")) return zeros;

  const text  = response.toLowerCase();
  const words = response.split(/\s+/).filter(Boolean);
  const wc    = words.length;
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 2);
  const promptWords = Math.max(1, (prompt||"").split(/\s+/).filter(Boolean).length);

  const codeBlocks = (response.match(/```/g)||[]).length / 2;
  const hasCode    = codeBlocks > 0 || /\b(def |function |SELECT |class |import )/.test(response);
  const hasTable   = (response.match(/\|/g)||[]).length >= 8;
  const hasLinks   = /https?:\/\/|www\./.test(response);
  const hasFigures = /[£$]\s?[\d,]+|\b\d+%|\b\d{4}\b/.test(response);
  const broken     = /\b(syntax error|traceback|is not defined|cannot read property)\b/.test(text);

  let substance = 55;
  if (hasCode)    substance += 15;
  if (hasTable)   substance += 10;
  if (hasLinks)   substance += 10;
  if (hasFigures) substance += 10;
  if (broken)     substance -= 30;
  substance = Math.max(0, Math.min(100, substance));

  const expected = Math.max(120, promptWords * 12);
  const ratio = wc / expected;
  let completeness;
  if (ratio < 1)       completeness = Math.round(ratio * 100);
  else if (ratio <= 2) completeness = 100;
  else                 completeness = Math.max(55, Math.round(100 - (ratio - 2) * 12));

  const headings = (response.match(/^#{1,3}\s/gm)||[]).length;
  const bullets  = (response.match(/^\s*[-*\u2022]\s/gm)||[]).length;
  const numbered = (response.match(/^\s*\d+[.)]\s/gm)||[]).length;
  const avgSent  = sentences.length ? wc / sentences.length : 0;

  let clarity = 50;
  if (headings > 0)            clarity += 15;
  if (bullets + numbered >= 2) clarity += 15;
  if (hasTable)                clarity += 10;
  if (avgSent >= 10 && avgSent <= 28) clarity += 10;
  clarity = Math.max(0, Math.min(100, clarity));

  const refusal = /\b(i cannot|i can't|i am unable|i'm unable|as an ai|i do not have access)\b/.test(text);
  const hedged  = /\b(verify|may have changed|as of my|please confirm|check directly|not certain)\b/.test(text);

  let reliability = 90;
  if (refusal) reliability -= 45;
  if (broken)  reliability -= 30;
  if (hedged)  reliability += 10;
  reliability = Math.max(0, Math.min(100, reliability));

  const overall = Math.round(substance*0.35 + completeness*0.20 + clarity*0.25 + reliability*0.20);
  return { correctness:substance, completeness, clarity, errorRate:reliability, overall };
}

// ── Run Benchmark ────────────────────────────────────────
async function runBenchmark() {
  const prompt   = document.getElementById("prompt").value.trim();
  const category = document.getElementById("category").value;
  if (!prompt) { alert("Please enter a prompt first!"); return; }

  document.getElementById("loading").style.display = "block";
  document.getElementById("results").style.display = "none";
  document.getElementById("runBtn").disabled = true;

  try {
    const res = await fetch(`${BACKEND}/benchmark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt, category,
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

function renderMarkdown(text) {
  if (!text) return "No response";
  try {
    return (typeof marked !== "undefined" && marked.parse) ? marked.parse(text) : text;
  } catch (e) { return text; }
}

// ── Display Results ──────────────────────────────────────
function displayResults(data, prompt) {
  const scores = {}, times = {}, tokens = {}, judge = {};
  MODEL_KEYS.forEach(k => {
    const r = data[k] || {};
    scores[k] = autoScore(r.response, prompt);
    times[k]  = r.time_ms || 0;
    tokens[k] = r.tokens || 0;
    judge[k]  = (r.llm && typeof r.llm.overall === "number") ? r.llm.overall : null;
  });

  const best = MODEL_KEYS.reduce((a, b) => scores[a].overall >= scores[b].overall ? a : b);
  const timed = MODEL_KEYS.filter(k => times[k] > 0);
  const fastest = timed.length ? timed.reduce((a, b) => times[a] < times[b] ? a : b) : null;

  // one card per model, revealed by the tabs above
  const list = document.getElementById("answerList");
  if (list) {
    MODEL_KEYS.forEach(k => {
      const isWin = k === best && scores[k].overall > 0;
      const pill = document.getElementById("tabscore-" + k);
      if (pill) {
        pill.innerHTML = (scores[k].overall ? scores[k].overall : "") +
          (isWin ? '<span class="tab-flag">Winner</span>' : "");
      }
      const tab = document.querySelector('#answerTabs .resp-tab[data-model="' + k + '"]');
      if (tab) tab.classList.toggle("is-winner", isWin);
    });
    list.innerHTML = MODEL_KEYS.map(k => {
      const r    = data[k] || {};
      const win  = k === best && scores[k].overall > 0;
      const body = r.error ? ("Error: " + r.error) : renderMarkdown(r.response);
      const badge = (!r.response || r.error)
        ? "No response"
        : (win
            ? '<span class="b-dot"></span>Winner &middot; ' + scores[k].overall + '/100'
            : (k === fastest ? "Fastest &middot; " + scores[k].overall + "/100"
                             : scores[k].overall + "/100"));
      return `
        <div class="answer-card ${win ? "win" : ""}" data-model="${k}">
          <div class="answer-head">
            <span class="answer-name">${MODEL_NAME[k]}</span>
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
              <span class="answer-meta">${times[k]} ms &middot; ${tokens[k] || "N/A"} tokens &middot; judge ${judge[k] == null ? "&mdash;" : judge[k] + "/100"}</span>
              <span class="answer-badge">${badge}</span>
            </div>
          </div>
          <div class="answer-body">${body}</div>
        </div>`;
    }).join("");
    showAnswer(best);
  }

  // verdict, uses the judge's real saved justification when there is one
  const vBar = document.getElementById("verdictBar");
  const vTxt = document.getElementById("verdictText");
  if (vBar && vTxt) {
    const det = (data[best] && data[best].llm) ? data[best].llm : null;
    let text = MODEL_NAME[best] + " scored highest on the rule-based rubric (" + scores[best].overall + "/100)";
    if (fastest) text += ", and " + MODEL_NAME[fastest] + " answered fastest at " + times[fastest] + " ms";
    text += ".";
    const failed = MODEL_KEYS.filter(k => !(data[k] && data[k].response));
    if (failed.length) {
      text += " " + failed.map(k => MODEL_NAME[k]).join(" and ") +
        (failed.length === 1 ? " returned no response" : " returned no responses") +
        ", so the zeros above are a failed API call, not a judgement" +
        (data[failed[0]] && data[failed[0]].error ? " (" + data[failed[0]].error + ")" : "") + ".";
    }
    if (det && det.justification) text += " LLM-as-Judge: " + det.justification;
    vTxt.textContent = text;
    vBar.style.display = "grid";
  }

  const ruleTbody = document.getElementById("scoreBody");
  if (ruleTbody) {
    fillScoreRows(ruleTbody, [
      { metric: "Response Time (ms)",   values: times,  lower: true },
      { metric: "Token Usage",          values: tokens, lower: true },
      { metric: "Substance (/100)",     values: { openai: scores.openai.correctness,  claude: scores.claude.correctness,  gemini: scores.gemini.correctness } },
      { metric: "Completeness (/100)",  values: { openai: scores.openai.completeness, claude: scores.claude.completeness, gemini: scores.gemini.completeness } },
      { metric: "Clarity (/100)",       values: { openai: scores.openai.clarity,      claude: scores.claude.clarity,      gemini: scores.gemini.clarity } },
      { metric: "Reliability (/100)",   values: { openai: scores.openai.errorRate,    claude: scores.claude.errorRate,    gemini: scores.gemini.errorRate } },
      { metric: "Overall Score (/100)", values: { openai: scores.openai.overall,      claude: scores.claude.overall,      gemini: scores.gemini.overall } },
    ]);
  }

  const llmVal = judgeValsFrom(data);

  const llmTbody = ensureLLMSection();
  if (llmTbody) {
    fillScoreRows(llmTbody, [
      { metric: "Substance (/100)",     values: llmVal("substance") },
      { metric: "Completeness (/100)",  values: llmVal("completeness") },
      { metric: "Clarity (/100)",       values: llmVal("clarity") },
      { metric: "Reliability (/100)",   values: llmVal("reliability") },
      { metric: "Overall Score (/100)", values: llmVal("overall") },
    ]);
  }

  renderCharts(data, scores, times, llmVal);

  const resultsEl = document.getElementById("results");
  if (resultsEl) {
    resultsEl.style.display = "block";
    setTimeout(() => resultsEl.scrollIntoView({ behavior: "smooth" }), 100);
  }
}

// ── Charts ───────────────────────────────────────────────
function renderCharts(data, scores, times, llmVal) {
  if (typeof Chart === "undefined") return;

  const FONT = "'Inter', sans-serif", INK = "#1a1008", MUTED = "#7a6a58", GRID = "#e7ddce";
  const DIMS = ["Substance", "Completeness", "Clarity", "Reliability", "Overall"];

  const base = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 1.45,
    layout: { padding: { top: 14 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: INK, titleColor: "#faf8f4", bodyColor: "#d4c9b8",
        padding: 12, cornerRadius: 10, displayColors: true, boxWidth: 10
      }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false },
           ticks: { color: INK, font: { family: FONT, size: 13, weight: "600" }, maxRotation: 30, minRotation: 0 } },
      y: { beginAtZero: true, max: 100,
           grid: { color: GRID }, border: { display: false },
           ticks: { color: MUTED, font: { family: FONT, size: 12 }, stepSize: 25 } }
    }
  };

  const columnSet = (getter) => MODEL_KEYS.map(k => ({
    label: MODEL_NAME[k],
    data: getter(k),
    backgroundColor: COLORS[k].bar,
    borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 2, bottomRight: 2 },
    borderSkipped: false,
    barPercentage: 0.82,
    categoryPercentage: 0.76
  }));

  if (chartRule) chartRule.destroy();
  chartRule = new Chart(document.getElementById("chartRule"), {
    type: "bar",
    data: { labels: DIMS, datasets: columnSet(k => [
      scores[k].correctness, scores[k].completeness, scores[k].clarity, scores[k].errorRate, scores[k].overall
    ]) },
    options: base
  });

  const jv = {
    substance: llmVal("substance"), completeness: llmVal("completeness"),
    clarity: llmVal("clarity"), reliability: llmVal("reliability"), overall: llmVal("overall")
  };

  // If the judge did not return anything for this run, say so instead of
  // leaving an empty grid on the page.
  const judgeTotal = Object.keys(jv).reduce((s, m) =>
    s + MODEL_KEYS.reduce((t, k) => t + (jv[m][k] || 0), 0), 0);
  const judgeCanvas = document.getElementById("chartJudge");
  if (judgeCanvas) {
    const card = judgeCanvas.closest(".chart-card");
    let note = card ? card.querySelector(".chart-empty") : null;
    if (card && !note) {
      note = document.createElement("div");
      note.className = "chart-empty";
      note.textContent = "The judge did not return scores for this run.";
      card.appendChild(note);
    }
    if (note) note.style.display = judgeTotal ? "none" : "block";
    judgeCanvas.style.display = judgeTotal ? "block" : "none";
  }

  if (chartJudge) chartJudge.destroy();
  chartJudge = new Chart(document.getElementById("chartJudge"), {
    type: "bar",
    data: { labels: DIMS, datasets: columnSet(k => [
      jv.substance[k], jv.completeness[k], jv.clarity[k], jv.reliability[k], jv.overall[k]
    ]) },
    options: base
  });

  if (chartTime) chartTime.destroy();
  chartTime = new Chart(document.getElementById("chartTime"), {
    type: "bar",
    data: { labels: MODEL_LABELS, datasets: [{
      data: MODEL_KEYS.map(k => times[k]),
      backgroundColor: MODEL_KEYS.map(k => COLORS[k].bar),
      borderRadius: 8, borderSkipped: false, barThickness: 34
    }]},
    options: {
      responsive: true, maintainAspectRatio: true, indexAxis: "y",
      aspectRatio: 3.2,
      layout: { padding: { right: 20 } },
      plugins: base.plugins,
      scales: {
        x: { beginAtZero: true, grid: { color: GRID }, border: { display: false },
             ticks: { color: MUTED, font: { family: FONT, size: 11 },
                      callback: v => Number(v).toLocaleString() } },
        y: { grid: { display: false }, border: { display: false },
             ticks: { color: INK, font: { family: FONT, size: 14, weight: "600" } } }
      }
    }
  });
}

// ── Recent runs on the home page (reads your existing /history) ──
function escapeHtmlText(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function loadRecentRuns() {
  const box = document.getElementById("recentRuns");
  if (!box) return;
  try {
    const res = await fetch(`${BACKEND}/history`);
    if (!res.ok) throw new Error("failed");
    const data = await res.json();

    const all = document.getElementById("viewAllRuns");
    if (all) all.textContent = "View all " + data.length + " run" + (data.length === 1 ? "" : "s");

    if (!data.length) {
      box.innerHTML = '<div class="runs-row"><span class="r-date">&mdash;</span><span class="r-prompt" style="color:#a09080;">No runs yet, your first benchmark will appear here.</span><span></span><span></span><span></span></div>';
      return;
    }

    box.innerHTML = data.slice(0, 6).map(r => {
      const s = { ChatGPT: r.openai_score || 0, Claude: r.claude_score || 0, Gemini: r.gemini_score || 0 };
      const win = Object.keys(s).reduce((a, b) => s[a] >= s[b] ? a : b);
      const date = (r.timestamp || "").split(" ")[0] || "";
      return `<div class="runs-row">
        <span class="r-date">${date}</span>
        <span class="r-prompt" title="${escapeHtmlText(r.prompt)}" onclick="openHistoryItem(${r.id})">${escapeHtmlText(r.prompt)}</span>
        <span class="r-cat">${escapeHtmlText(r.category || "")}</span>
        <span class="r-win">${win}</span>
        <span class="r-score">${s[win]}</span>
      </div>`;
    }).join("");
  } catch (e) {
    box.innerHTML = '<div class="runs-row"><span class="r-date">&mdash;</span><span class="r-prompt" style="color:#a09080;">Could not load recent runs.</span><span></span><span></span><span></span></div>';
  }
}

window.addEventListener("load", loadRecentRuns);

// ── Show one model's answer at a time ─────────────────────
function showAnswer(model) {
  document.querySelectorAll("#answerTabs .resp-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.model === model));
  document.querySelectorAll("#answerList .answer-card").forEach(c => {
    c.style.display = c.dataset.model === model ? "block" : "none";
  });
}
