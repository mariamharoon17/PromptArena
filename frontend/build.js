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

// ── Build a Website ───────────────────────────────────────
let BUILD_HTML = {};

chipGroup("buildFlags", true);

function setViewport(vp) {
  document.querySelectorAll(".viewport-row .chip").forEach(c => c.classList.toggle("active", c.dataset.vp === vp));
  document.querySelectorAll(".preview-frame").forEach(f => f.classList.toggle("mobile", vp === "mobile"));
}

// Models format their replies differently: Claude often writes a short intro,
// then a fenced block tagged html/HTML, sometimes with several smaller snippets
// after it. Take the LARGEST block that actually looks like a document, and
// fall back to slicing the raw <!doctype>/<html> span out of the reply.
function extractHTML(text) {
  if (!text) return "";
  const looksLikeDoc = (s) => /<html|<!doctype|<body|<main|<section|<div/i.test(s);

  // Some replies arrive HTML-escaped (&lt;!DOCTYPE html&gt;). Unescape those,
  // and drop a stray leading "html" language token if the fence was malformed.
  const clean = (s) => {
    let out = s.replace(/^\s*html\s*\r?\n/i, "").trim();
    if (!/</.test(out) && /&lt;/.test(out)) {
      out = out.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    }
    return out.trim();
  };

  const blocks = [];
  const fence = /```[ \t]*([a-z]*)[ \t]*\r?\n([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(text)) !== null) {
    const lang = (m[1] || "").toLowerCase();
    const body = clean(m[2] || "");
    if (!body) continue;
    if (lang && !["html", "htm", "xml", "jinja", "jinja2", "django", ""].includes(lang)) continue;
    if (looksLikeDoc(body)) blocks.push(body);
  }
  if (blocks.length) return blocks.sort((x, y) => y.length - x.length)[0];

  // unterminated fence (response cut off mid-stream)
  const open = text.match(/```[ \t]*html[ \t]*\r?\n([\s\S]+)$/i);
  if (open && looksLikeDoc(open[1])) return clean(open[1]);

  // no fences at all: pull the document out of the prose
  const doc = text.match(/<!doctype html[\s\S]*?<\/html>/i) || text.match(/<html[\s\S]*?<\/html>/i);
  if (doc) return clean(doc[0]);

  const loose = text.match(/<(?:body|main|section|div)[\s\S]*$/i);
  if (loose && looksLikeDoc(loose[0])) return clean(loose[0]);

  return looksLikeDoc(text) ? clean(text) : "";
}

// A reply can be cut off by the model's token limit, or be a bare fragment.
// Close what is open and wrap fragments, so the frame paints something real
// instead of a blank page.
function repairHTML(html) {
  if (!html) return "";
  let out = html.trim();
  if (!/<html[\s>]/i.test(out) && !/<!doctype/i.test(out)) {
    out = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' +
          out + '</body></html>';
  }
  if (!/<\/html>/i.test(out)) {
    if (/<style[\s>]/i.test(out) && !/<\/style>/i.test(out)) out += "\n</style>";
    if (/<body/i.test(out) && !/<\/body>/i.test(out)) out += "\n</body>";
    out += "\n</html>";
  }
  return out;
}

function isTruncated(html) { return !!html && !/<\/html>/i.test(html.trim()); }

function hasVisibleBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const inner = m ? m[1] : html;
  return /<(h1|h2|h3|p|section|main|header|nav|ul|ol|table|img|a|button|form|footer|article|div)\b/i.test(inner);
}

function buildPromptText() {
  const desc  = document.getElementById("buildPrompt").value.trim();
  const stack = document.getElementById("buildStack").value;
  const tone  = document.getElementById("buildTone").value;
  const flags = activeChips("buildFlags", "flag");
  return [
    "Build a website: " + desc, "",
    "Deliver " + stack + ".",
    "Visual tone: " + tone + ".",
    flags.length ? "Requirements: " + flags.join(", ") + "." : "", "",
    "Return ONE complete, self-contained file starting with <!DOCTYPE html> and ending with </html>, inside a single fenced code block tagged html. Do not add any commentary, notes or extra code blocks before or after it.",
    "Keep the whole file under about 200 lines and finish it — a file that stops halfway counts as a failure."
  ].filter(Boolean).join("\n");
}

async function runBuild() {
  const desc = document.getElementById("buildPrompt").value.trim();
  if (!desc) { alert("Describe the site you want first."); return; }

  const prompt = buildPromptText();
  document.getElementById("buildLoading").style.display = "block";
  document.getElementById("buildResults").style.display = "none";
  document.getElementById("buildBtn").disabled = true;

  try {
    renderBuild(await askAllThree(prompt, "Website"), prompt);
  } catch (err) {
    alert("Cannot reach backend! Make sure Flask is running.");
    console.error(err);
  } finally {
    document.getElementById("buildLoading").style.display = "none";
    document.getElementById("buildBtn").disabled = false;
  }
}

function checkList(html) {
  return [
    ["Renders without errors",  !!html],
    ["Responsive rules present", /@media|minmax\(|flex-wrap|grid-template-columns/i.test(html)],
    ["Semantic landmarks",       /<(header|main|nav|footer|section|article)\b/i.test(html)],
    ["Labelled form inputs",     !/<input/i.test(html) || /<label|aria-label/i.test(html)]
  ];
}

function renderBuild(data, prompt) {
  const scores = {}, times = {}, judge = {}, cut = {};
  MODEL_KEYS.forEach(k => {
    const r = data[k] || {};
    const raw = extractHTML(r.response);
    cut[k] = isTruncated(raw);
    BUILD_HTML[k] = repairHTML(raw);
    if (BUILD_HTML[k] && !hasVisibleBody(BUILD_HTML[k])) BUILD_HTML[k] = "";
    scores[k] = autoScore(r.response, prompt);
    times[k]  = r.time_ms || 0;
    judge[k]  = judgeOf(r);
  });

  const best = MODEL_KEYS.reduce((a, b) => scores[a].overall >= scores[b].overall ? a : b);

  document.getElementById("previewGrid").innerHTML = MODEL_KEYS.map(k => {
    const html = BUILD_HTML[k];
    const win  = k === best && scores[k].overall > 0;
    const checks = checkList(html).map(c =>
      `<div><i class="${c[1] ? "ok" : ""}"></i>${c[0]}</div>`).join("");
    const warn = cut[k]
      ? `<div class="preview-warn">Response was cut off before &lt;/html&gt;. Raise max_tokens for ${MODEL_NAME[k]} in app.py.</div>`
      : (!html && !(data[k] || {}).response
          ? `<div class="preview-warn">No response from ${MODEL_NAME[k]}${(data[k] || {}).error ? ": " + (data[k].error) : " (API error)"}.</div>`
          : "");
    return `
      <div class="preview-card ${win ? "win" : ""}">
        <div class="preview-head">
          <span class="preview-name">${MODEL_NAME[k]}</span>
          <span class="preview-score">${win ? "Winner &middot; " : ""}${scores[k].overall}/100</span>
        </div>
        <div class="preview-frame-wrap">
          ${html
            ? `<iframe class="preview-frame" data-model="${k}" sandbox="allow-scripts allow-popups" title="${MODEL_NAME[k]} preview"></iframe>`
            : `<div class="preview-frame" style="display:flex;align-items:center;justify-content:center;color:#a09080;font-size:0.82rem;">No renderable HTML returned</div>`}
        </div>
        <div class="preview-checks">${checks}</div>
        ${warn}
        <div class="preview-actions">
          <button type="button" onclick="copyText(BUILD_HTML['${k}'], this)">Copy</button>
          <button type="button" onclick="openBuild('${k}')">Open</button>
          <button type="button" onclick="downloadBuild('${k}')">Download</button>
        </div>
      </div>`;
  }).join("");

  // Write the document straight into each frame instead of through a srcdoc
  // attribute — attribute escaping is what made Claude's file show up as text.
  document.querySelectorAll("#previewGrid iframe.preview-frame").forEach(f => {
    const doc = BUILD_HTML[f.dataset.model];
    if (!doc) return;
    f.srcdoc = doc;
  });

  MODEL_KEYS.forEach(k => {
    const isWin = k === best && scores[k].overall > 0;
    const pill = document.getElementById("buildTabs-" + k);
    if (pill) pill.innerHTML = (scores[k].overall || "") + (isWin ? '<span class="tab-flag">Winner</span>' : "");
    const tab = document.querySelector('#buildTabs .resp-tab[data-model="' + k + '"]');
    if (tab) tab.classList.toggle("is-winner", isWin);
  });

  document.getElementById("buildCodeList").innerHTML = MODEL_KEYS.map(k => {
    const r = data[k] || {};
    return `
      <div class="answer-card ${k === best ? "win" : ""}" data-model="${k}">
        <div class="answer-head">
          <span class="answer-name">${MODEL_NAME[k]}</span>
          <span class="answer-meta">${times[k]} ms &middot; ${(r.tokens || "N/A")} tokens</span>
        </div>
        <div class="answer-body">${renderMarkdown(r.response)}</div>
      </div>`;
  }).join("");
  showBuildCode(best);

  const det = (data[best] && data[best].llm) ? data[best].llm : null;
  const rendered = MODEL_KEYS.filter(k => BUILD_HTML[k]).map(k => MODEL_NAME[k]);
  let verdict = rendered.length
    ? rendered.join(", ") + (rendered.length === 1 ? " returned" : " returned") + " renderable HTML. "
    : "No model returned renderable HTML. ";
  verdict += MODEL_NAME[best] + " scored highest overall (" + scores[best].overall + "/100).";
  const failed = MODEL_KEYS.filter(k => !(data[k] && data[k].response));
  if (failed.length) {
    verdict += " " + failed.map(k => MODEL_NAME[k]).join(" and ") +
      " returned no response at all, so those zeros are a failed API call rather than a judgement" +
      (data[failed[0]] && data[failed[0]].error ? " (" + data[failed[0]].error + ")" : "") + ".";
  }
  if (det && det.justification) verdict += " LLM-as-Judge: " + det.justification;
  document.getElementById("buildVerdict").textContent = verdict;

  fillTable("buildScoreBody", scoreRowsFor(scores, times, judge, [
    { metric: "Renderable HTML", values: {
        openai: BUILD_HTML.openai ? 100 : 0,
        claude: BUILD_HTML.claude ? 100 : 0,
        gemini: BUILD_HTML.gemini ? 100 : 0 } }
  ]));

  const box = document.getElementById("buildResults");
  box.style.display = "block";
  renderJudgeAndCharts(data, scores, times, "buildJudgeBody");
  setTimeout(() => box.scrollIntoView({ behavior: "smooth" }), 100);
}

function openBuild(k) {
  const html = BUILD_HTML[k];
  if (!html) { alert("No HTML returned by this model."); return; }
  const blob = new Blob([html], { type: "text/html" });
  window.open(URL.createObjectURL(blob), "_blank");
}

function downloadBuild(k) {
  const blob = new Blob([BUILD_HTML[k] || ""], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "promptarena-" + k + ".html";
  a.click();
  URL.revokeObjectURL(a.href);
}

function showBuildCode(model) {
  document.querySelectorAll("#buildTabs .resp-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.model === model));
  document.querySelectorAll("#buildCodeList .answer-card").forEach(c => {
    c.style.display = c.dataset.model === model ? "block" : "none";
  });
}
