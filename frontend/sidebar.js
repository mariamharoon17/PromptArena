const BACKEND = "";
let activeProjectId = null;
let activeProjectName = null;

// ── Inject sidebar into every page ───────────────────────
function injectSidebar() {
  const path = location.pathname;
  const isHome = path === "/" || path === "/index.html" || path === "";
  const sidebarHTML = `
    <button class="sidebar-toggle" onclick="toggleSidebar()">&#9776;</button>
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div>
          <span class="sidebar-logo">PromptArena</span>
        </div>
        <button class="sidebar-close" onclick="closeSidebar()">&#x2715;</button>
      </div>

      <div class="sidebar-nav">
        <a href="/" class="sidebar-link ${isHome ? 'active' : ''}">
          <span class="sidebar-num">01</span> Benchmark
        </a>
        <a href="/build.html" class="sidebar-link ${path.includes('build') ? 'active' : ''}">
          <span class="sidebar-num">02</span> Build a Website
        </a>
        <a href="/assist.html" class="sidebar-link ${path.includes('assist') ? 'active' : ''}">
          <span class="sidebar-num">03</span> Code Assist
        </a>
        <a href="/learn-more.html" class="sidebar-link ${path.includes('learn-more') ? 'active' : ''}">
          <span class="sidebar-num">04</span> Methodology
        </a>
        <a href="/history.html" class="sidebar-link ${path.includes('history') ? 'active' : ''}">
          <span class="sidebar-num">05</span> History
        </a>
        <a href="/about.html" class="sidebar-link ${path.includes('about') ? 'active' : ''}">
          <span class="sidebar-num">06</span> About
        </a>
      </div>

      <div class="sidebar-nav">
        <div class="sidebar-nav-label" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Projects</span>
          <button onclick="showNewProjectInput()" style="background:none;border:none;color:#7a6a58;font-size:1.2rem;cursor:pointer;padding:0 4px;line-height:1;">+</button>
        </div>
        <div id="new-project-input" style="display:none;padding:6px 0;">
          <input type="text" id="project-name-input" placeholder="Project name..."
            style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid #ddd3c4;background:#fffdf9;color:#1a1008;font-size:0.86rem;font-family:'Inter',sans-serif;outline:none;"
            onkeydown="if(event.key==='Enter') createProject()"/>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button onclick="createProject()" style="flex:1;background:#1a1008;color:#faf8f4;border:none;padding:8px;border-radius:999px;font-size:0.72rem;cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Create</button>
            <button onclick="hideNewProjectInput()" style="flex:1;background:transparent;color:#7a6a58;border:1px solid #ddd3c4;padding:8px;border-radius:999px;font-size:0.72rem;cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Cancel</button>
          </div>
        </div>
        <div id="projects-list" style="margin-top:4px;"></div>
      </div>

      <div class="sidebar-history">
        <div class="sidebar-history-label">Recent Benchmarks</div>
        <div id="sidebar-history-list">
          <div style="font-size:0.8rem;color:#a09080;padding:8px 10px;">Loading...</div>
        </div>
      </div>

      <div class="sidebar-footer">
        <button class="sidebar-new-btn" onclick="closeSidebar(); window.location.href='/';">
          + New Benchmark
        </button>
      </div>
    </div>

    <!-- Project Chat Modal -->
    <div id="project-modal-overlay" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:#00000070;z-index:2000;backdrop-filter:blur(4px);">
      <div id="project-modal" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#faf8f4;border-radius:18px;width:90%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid #ddd3c4;">

        <div style="padding:20px 24px;border-bottom:1px solid #d4c9b8;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:0.65rem;letter-spacing:2px;text-transform:uppercase;color:#7a6a58;margin-bottom:4px;">Project</div>
            <div id="modal-project-name" style="font-family:'Playfair Display',serif;font-size:1.2rem;color:#1a1008;font-weight:700;"></div>
          </div>
          <button onclick="closeProjectModal()" style="background:#1a1008;color:#faf8f4;border:none;padding:8px 16px;border-radius:999px;font-size:0.72rem;cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Close</button>
        </div>

        <div id="modal-history" style="flex:1;overflow-y:auto;padding:16px 24px;"></div>

        <div style="padding:16px 24px;border-top:1px solid #d4c9b8;background:#ffffff;">
          <div style="display:flex;gap:10px;align-items:flex-end;">
            <div style="flex:1;">
              <select id="modal-category" style="width:100%;padding:8px 12px;border:1px solid #ddd3c4;border-radius:8px;background:#faf8f4;color:#1a1008;font-family:'Inter',sans-serif;font-size:0.85rem;margin-bottom:8px;">
                <option value="General">General (any topic)</option>
                <option value="Funding Research">Funding Research</option>
                <option value="Database">Database / SQL</option>
                <option value="Creative">Creative Writing</option>
                <option value="Reasoning">Reasoning & Logic</option>
              </select>
              <textarea id="modal-prompt" rows="2" placeholder="Enter your prompt and press Enter..."
                style="width:100%;padding:10px 14px;border:1px solid #ddd3c4;border-radius:8px;background:#faf8f4;color:#1a1008;font-family:'Inter',sans-serif;font-size:0.88rem;resize:none;"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();runProjectBenchmark();}"></textarea>
            </div>
            <button onclick="runProjectBenchmark()" id="modal-run-btn"
              style="background:#1a1008;color:#faf8f4;border:none;padding:12px 20px;border-radius:999px;font-size:0.72rem;cursor:pointer;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;margin-bottom:2px;">
              Run →
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
  mountToggleInNav();
  if (isDocked()) document.body.classList.add("sb-collapsed");
  loadProjects();
  loadSidebarHistory();
}

// Move the toggle into the top bar so the button, wordmark and page
// content all share one left edge whether the sidebar is open or closed.
function mountToggleInNav() {
  const btn = document.querySelector(".sidebar-toggle");
  const bar = document.querySelector("nav");
  const logo = bar ? bar.querySelector(".logo") : null;
  if (!btn || !bar || !logo) return;
  const left = document.createElement("div");
  left.className = "nav-left";
  logo.parentNode.insertBefore(left, logo);
  left.appendChild(btn);
  left.appendChild(logo);
}

// ── Sidebar toggle ────────────────────────────────────────
function isDocked() { return window.matchMedia("(min-width: 1100px)").matches; }

function toggleSidebar() {
  if (isDocked()) {
    // desktop: collapse / expand the docked rail
    const collapsed = document.body.classList.toggle("sb-collapsed");
    try { localStorage.setItem("pa-sidebar-collapsed", collapsed ? "1" : "0"); } catch (e) {}
    if (!collapsed) { loadSidebarHistory(); loadProjects(); }
    return;
  }
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar.classList.contains("open")) { closeSidebar(); }
  else {
    sidebar.classList.add("open");
    overlay.classList.add("open");
    loadSidebarHistory();
    loadProjects();
  }
}

function closeSidebar() {
  if (isDocked()) return;
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("open");
}

// ── Projects ─────────────────────────────────────────────
function showNewProjectInput() {
  document.getElementById("new-project-input").style.display = "block";
  document.getElementById("project-name-input").focus();
}

function hideNewProjectInput() {
  document.getElementById("new-project-input").style.display = "none";
  document.getElementById("project-name-input").value = "";
}

async function createProject() {
  const name = document.getElementById("project-name-input").value.trim();
  if (!name) return;
  try {
    const res = await fetch(`${BACKEND}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      hideNewProjectInput();
      loadProjects();
    }
  } catch (err) {
    console.error("Could not create project:", err);
  }
}

async function loadProjects() {
  try {
    const res      = await fetch(`${BACKEND}/projects`);
    const projects = await res.json();
    const list     = document.getElementById("projects-list");

    if (!projects.length) {
      list.innerHTML = "<div style='font-size:0.8rem;color:#a09080;padding:6px 10px;line-height:1.5;'>No projects yet, click + to create one</div>";
      return;
    }

    list.innerHTML = projects.map(p => `
      <div class="sidebar-history-item"
           style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:${activeProjectId === p.id ? 'rgba(26,16,8,0.06)' : 'transparent'};border-radius:10px;"
           onclick="openProjectModal(${p.id}, '${p.name.replace(/'/g,"\\'")}')">
        <div style="display:flex;align-items:center;gap:8px;overflow:hidden;">
          <span style="font-size:0.85rem;">📁</span>
          <span style="font-size:0.86rem;color:${activeProjectId === p.id ? '#1a1008' : '#4a3a2a'};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${p.name}
          </span>
        </div>
        <button onclick="event.stopPropagation(); deleteProject(${p.id})"
          style="background:none;border:none;color:#a09080;font-size:0.72rem;cursor:pointer;flex-shrink:0;padding:2px 4px;">✕</button>
      </div>
    `).join("");
  } catch (err) {
    console.error("Could not load projects:", err);
  }
}

async function deleteProject(id) {
  if (!confirm("Delete this project?")) return;
  await fetch(`${BACKEND}/projects/${id}`, { method: "DELETE" });
  if (activeProjectId === id) {
    activeProjectId = null;
    activeProjectName = null;
  }
  loadProjects();
}

// ── Project Chat Modal ────────────────────────────────────
async function openProjectModal(id, name) {
  closeSidebar();
  activeProjectId   = id;
  activeProjectName = name;
  document.getElementById("modal-project-name").textContent = name;
  document.getElementById("project-modal-overlay").style.display = "block";
  await loadProjectHistory(id);
}

function closeProjectModal() {
  document.getElementById("project-modal-overlay").style.display = "none";
  activeProjectId   = null;
  activeProjectName = null;
}

async function loadProjectHistory(id) {
  const container = document.getElementById("modal-history");
  container.innerHTML = "<div style='color:#7a6a58;font-size:0.85rem;'>Loading...</div>";
  try {
    const res  = await fetch(`${BACKEND}/projects/${id}/benchmarks`);
    const data = await res.json();

    if (!data.length) {
      container.innerHTML = "<div style='color:#a09080;font-size:0.85rem;text-align:center;padding:40px 0;'>No benchmarks in this project yet.<br/>Enter a prompt below to get started.</div>";
      return;
    }

    container.innerHTML = data.map(row => `
      <div style="margin-bottom:20px;padding:16px;background:#ffffff;border:1px solid #ddd3c4;border-radius:12px;">
        <div style="font-size:0.65rem;letter-spacing:2px;text-transform:uppercase;color:#7a6a58;margin-bottom:6px;">${row.timestamp} · ${row.category}</div>
        <div style="font-family:'Playfair Display',serif;font-size:0.95rem;color:#1a1008;margin-bottom:12px;font-weight:600;">${row.prompt}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
          ${modelCell("ChatGPT", row.openai_response, row.openai_time, row.openai_score, "#10A37F")}
          ${modelCell("Claude",  row.claude_response,  row.claude_time,  row.claude_score,  "#D97757")}
          ${modelCell("Gemini",  row.gemini_response,  row.gemini_time,  row.gemini_score,  "#4285F4")}
        </div>
      </div>
    `).join("");
  } catch {
    container.innerHTML = "<div style='color:#a09080;font-size:0.85rem;'>Could not load benchmarks.</div>";
  }
}

function modelCell(name, response, time, score, color) {
  const preview = response ? (response.length > 100 ? response.substring(0,100)+"..." : response) : "No response";
  return `
    <div style="background:#faf8f4;border-radius:8px;padding:12px;border-left:3px solid ${color};">
      <div style="font-size:0.68rem;font-weight:600;color:${color};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">${name}</div>
      <div style="font-size:0.8rem;color:#3a2e1e;line-height:1.5;margin-bottom:8px;">${preview}</div>
      <div style="font-size:0.7rem;color:#7a6a58;">⏱ ${time}ms · ⭐ ${score}/100</div>
    </div>
  `;
}

async function runProjectBenchmark() {
  const prompt   = document.getElementById("modal-prompt").value.trim();
  const category = document.getElementById("modal-category").value;
  if (!prompt) return;

  const btn = document.getElementById("modal-run-btn");
  btn.textContent = "Running...";
  btn.disabled    = true;

  try {
    const res = await fetch(`${BACKEND}/benchmark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, category, project_id: activeProjectId })
    });
    await res.json();
    document.getElementById("modal-prompt").value = "";
    await loadProjectHistory(activeProjectId);
  } catch (err) {
    alert("Could not reach backend!");
  } finally {
    btn.textContent = "Run →";
    btn.disabled    = false;
  }
}

// ── Recent Benchmarks ─────────────────────────────────────
async function loadSidebarHistory() {
  const list = document.getElementById("sidebar-history-list");
  try {
    const res  = await fetch(`${BACKEND}/history`);
    if (!res.ok) throw new Error("Failed");
    const data = await res.json();

    if (!data.length) {
      list.innerHTML = "<div style='font-size:0.8rem;color:#a09080;padding:8px 10px;'>No benchmarks yet</div>";
      return;
    }

    list.innerHTML = data.slice(0, 10).map(row => `
      <div class="sidebar-history-item" onclick="openHistoryItem(${row.id})">
        <div class="sidebar-history-prompt">${row.prompt.length > 40 ? row.prompt.substring(0,40)+'...' : row.prompt}</div>
        <div class="sidebar-history-meta">${row.category} · ${row.timestamp.split(" ")[0]}</div>
      </div>
    `).join("");
  } catch {
    list.innerHTML = "<div style='font-size:0.8rem;color:#a09080;padding:8px 10px;'>No history yet</div>";
  }
}

function openHistoryItem(id) {
  closeSidebar();
  fetch(`${BACKEND}/history`)
    .then(r => r.json())
    .then(data => {
      const item = data.find(r => r.id === id);
      if (!item) return;
      if (location.pathname !== "/" && location.pathname !== "/index.html") {
        window.location.href = "/";
        return;
      }
      document.getElementById("prompt").value   = item.prompt;
      document.getElementById("category").value = item.category;
      const savedData = {
        prompt: item.prompt, category: item.category,
        openai: { response: item.openai_response, time_ms: item.openai_time, tokens: item.openai_tokens, error: null, unavailable: false },
        claude: { response: item.claude_response, time_ms: item.claude_time, tokens: item.claude_tokens, error: null, unavailable: false },
        gemini: { response: item.gemini_response, time_ms: item.gemini_time, tokens: item.gemini_tokens, error: null, unavailable: false },
      };
      if (typeof displayResults === "function") {
        displayResults(savedData, item.prompt);
        setTimeout(() => document.getElementById("results").scrollIntoView({ behavior: "smooth" }), 100);
      }
    });
}

document.addEventListener("keydown", e => { if (e.key === "Escape") { closeSidebar(); closeProjectModal(); } });

document.addEventListener("DOMContentLoaded", injectSidebar);