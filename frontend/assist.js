// Shared helpers for Build + Code Assist.
// Both post to the EXISTING /benchmark endpoint, so every run is stored in your
// existing database and appears in History and Projects. No schema change.

function chipGroup(containerId, multi) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (multi) chip.classList.toggle("active");
    else {
      box.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    }
  });
}

function activeChips(containerId, attr) {
  return Array.from(document.querySelectorAll("#" + containerId + " .chip.active"))
              .map(c => c.dataset[attr]);
}

function judgeOf(entry) {
  return entry && entry.llm && typeof entry.llm.overall === "number" ? entry.llm.overall : null;
}

function fillTable(tbodyId, rows) {
  const tbody = document.getElementById(tbodyId);
  if (tbody) fillScoreRows(tbody, rows);
}

async function askAllThree(prompt, category) {
  const res = await fetch(`${BACKEND}/benchmark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt, category,
      project_id: typeof activeProjectId !== "undefined" ? activeProjectId : null
    })
  });
  return res.json();
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text || "").then(() => {
    const old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = old; }, 1400);
  });
}

function scoreRowsFor(scores, times, judge, extra) {
  return (extra || []).concat([
    { metric: "Response Time (ms)",   values: times, lower: true },
    { metric: "Substance (/100)",     values: { openai: scores.openai.correctness,  claude: scores.claude.correctness,  gemini: scores.gemini.correctness } },
    { metric: "Completeness (/100)",  values: { openai: scores.openai.completeness, claude: scores.claude.completeness, gemini: scores.gemini.completeness } },
    { metric: "Clarity (/100)",       values: { openai: scores.openai.clarity,      claude: scores.claude.clarity,      gemini: scores.gemini.clarity } },
    { metric: "Reliability (/100)",   values: { openai: scores.openai.errorRate,    claude: scores.claude.errorRate,    gemini: scores.gemini.errorRate } },
    { metric: "Rule Overall (/100)",  values: { openai: scores.openai.overall,      claude: scores.claude.overall,      gemini: scores.gemini.overall } },
    { metric: "LLM-as-Judge (/100)",  values: judge }
  ]);
}

function llmValsFrom(data) { return judgeValsFrom(data); }

// Same judge table + three charts the Benchmark page draws.
function renderJudgeAndCharts(data, scores, times, judgeTbodyId) {
  const llmVal = llmValsFrom(data);
  fillTable(judgeTbodyId, [
    { metric: "Substance (/100)",     values: llmVal("substance") },
    { metric: "Completeness (/100)",  values: llmVal("completeness") },
    { metric: "Clarity (/100)",       values: llmVal("clarity") },
    { metric: "Reliability (/100)",   values: llmVal("reliability") },
    { metric: "Overall Score (/100)", values: llmVal("overall") }
  ]);
  if (typeof renderCharts === "function") renderCharts(data, scores, times, llmVal);
}

// ── Code Assist ───────────────────────────────────────────
let ASSIST_TEXT = {};

chipGroup("assistTasks", false);

function assistPromptText() {
  const task  = activeChips("assistTasks", "task")[0] || "Explain this code.";
  const lang  = document.getElementById("assistLang").value;
  const code  = document.getElementById("assistCode").value;
  const notes = document.getElementById("assistNotes").value.trim();
  return [
    task,
    notes ? "Context: " + notes : "", "",
    "Language: " + lang, "",
    code, "",
    "Answer concisely. If you change the code, show the full corrected version in one code block, then explain the change in no more than five bullet points."
  ].filter(Boolean).join("\n");
}

async function runAssist() {
  const code = document.getElementById("assistCode").value.trim();
  if (!code) { alert("Paste some code first."); return; }

  const prompt = assistPromptText();
  document.getElementById("assistLoading").style.display = "block";
  document.getElementById("assistResults").style.display = "none";
  document.getElementById("assistBtn").disabled = true;

  try {
    renderAssist(await askAllThree(prompt, "Coding"), prompt);
  } catch (err) {
    alert("Cannot reach backend! Make sure Flask is running.");
    console.error(err);
  } finally {
    document.getElementById("assistLoading").style.display = "none";
    document.getElementById("assistBtn").disabled = false;
  }
}

function renderAssist(data, prompt) {
  const scores = {}, times = {}, judge = {};
  MODEL_KEYS.forEach(k => {
    const r = data[k] || {};
    ASSIST_TEXT[k] = r.response || "";
    scores[k] = autoScore(r.response, prompt);
    times[k]  = r.time_ms || 0;
    judge[k]  = judgeOf(r);
  });

  const best  = MODEL_KEYS.reduce((a, b) => scores[a].overall >= scores[b].overall ? a : b);
  const timed = MODEL_KEYS.filter(k => times[k] > 0);
  const fastest = timed.length ? timed.reduce((a, b) => times[a] < times[b] ? a : b) : null;

  MODEL_KEYS.forEach(k => {
    const isWin = k === best && scores[k].overall > 0;
    const pill = document.getElementById("assistTabs-" + k);
    if (pill) pill.innerHTML = (scores[k].overall || "") + (isWin ? '<span class="tab-flag">Winner</span>' : "");
    const tab = document.querySelector('#assistTabs .resp-tab[data-model="' + k + '"]');
    if (tab) tab.classList.toggle("is-winner", isWin);
  });

  document.getElementById("fixList").innerHTML = MODEL_KEYS.map(k => {
    const win = k === best && scores[k].overall > 0;
    return `
      <div class="answer-card ${win ? "win" : ""}" data-model="${k}">
        <div class="answer-head">
          <span class="answer-name">${MODEL_NAME[k]}</span>
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <span class="answer-meta">${times[k]} ms &middot; rule ${scores[k].overall}/100 &middot; judge ${judge[k] == null ? "&mdash;" : judge[k] + "/100"}</span>
            <span class="answer-badge">${win ? '<span class="b-dot"></span>Winner &middot; ' + scores[k].overall + '/100' : scores[k].overall + '/100'}</span>
            <button type="button" class="wide-toggle" onclick="copyText(ASSIST_TEXT['${k}'], this)">Copy</button>
          </div>
        </div>
        <div class="answer-body">${renderMarkdown(ASSIST_TEXT[k])}</div>
      </div>`;
  }).join("");
  showAssistAnswer(best);

  const det = (data[best] && data[best].llm) ? data[best].llm : null;
  let verdict = MODEL_NAME[best] + " scored highest (" + scores[best].overall + "/100)";
  if (fastest) verdict += ", " + MODEL_NAME[fastest] + " answered fastest at " + times[fastest] + " ms";
  verdict += ".";
  if (det && det.justification) verdict += " LLM-as-Judge: " + det.justification;
  const failed = MODEL_KEYS.filter(k => !(data[k] && data[k].response));
  if (failed.length) {
    verdict += " " + failed.map(k => MODEL_NAME[k]).join(" and ") +
      " returned no response, so those zeros are a failed API call rather than a judgement" +
      (data[failed[0]] && data[failed[0]].error ? " (" + data[failed[0]].error + ")" : "") + ".";
  }
  document.getElementById("assistVerdict").textContent = verdict;

  fillTable("assistScoreBody", scoreRowsFor(scores, times, judge));

  const box = document.getElementById("assistResults");
  box.style.display = "block";
  renderJudgeAndCharts(data, scores, times, "assistJudgeBody");
  setTimeout(() => box.scrollIntoView({ behavior: "smooth" }), 100);
}

function showAssistAnswer(model) {
  document.querySelectorAll("#assistTabs .resp-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.model === model));
  document.querySelectorAll("#fixList .answer-card").forEach(c => {
    c.style.display = c.dataset.model === model ? "block" : "none";
  });
}
