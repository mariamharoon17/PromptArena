# PromptArena: AI-Assisted Coding and Web Development Assessment Tool

PromptArena is a live web application that benchmarks three commercial large
language models side by side under identical conditions. The same prompt is sent
simultaneously to **OpenAI GPT-4o**, **Anthropic Claude Sonnet 4.6** and
**Google Gemini 2.5 Pro**. Each response is scored by two independent methods,
a transparent rule-based scorer and an LLM-as-Judge, alongside its response time
and token usage.

Developed as the practical component of an MSc Artificial Intelligence dissertation
at Aston University (2025 to 2026).

**Live application:** https://promptarena.greenisland-ffe001c0.uksouth.azurecontainerapps.io/

---

## About the website

PromptArena is designed to let both technical and non-technical users compare
leading AI models on their own prompts, rather than relying on aggregate public
leaderboards. A user selects a task category, enters a prompt, and the platform
sends it to all three models at once, then displays their answers side by side
with quality scores, response times and token usage, so the differences between
the models are immediately visible.

The website provides three modes:

- **Benchmark:** enter any prompt and compare how the three models respond,
  with each answer scored and a winning model highlighted.
- **Build a Website:** provide a single website brief; the platform sends the
  identical brief to all three models and renders the generated pages so they can
  be compared as real interfaces rather than as raw code.
- **Code Assist:** compare the models on coding tasks such as explaining code,
  finding bugs, writing tests and refactoring.

Every run is saved to a benchmark history, where results can be revisited,
viewed as charts and exported as a CSV file.

---

## Features

- Sends one identical prompt to three models at the same time for a fair comparison
- Rule-based scoring across four weighted dimensions:
  **Substance (35%), Clarity (25%), Completeness (20%), Reliability (20%)**
- Independent **LLM-as-Judge** scoring of the same responses (GPT-4o, temperature 0)
- Records response time, token usage, the winning model and failed API calls
- Persistent benchmark history with per-run charts and CSV export

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, Flask |
| Frontend | HTML, CSS, JavaScript, Chart.js, marked.js |
| Database | SQLite (local development) / Azure MySQL (production) |
| Deployment | Docker, Azure Container Registry, Azure Container Apps |

---

## Running locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mariamharoon17/promptarena.git
   cd promptarena
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Create a `.env` file** in the project root with your own API keys:
   ```
   OPENAI_API_KEY=your_key_here
   ANTHROPIC_API_KEY=your_key_here
   GEMINI_API_KEY=your_key_here
   ```

4. **Run the application:**
   ```bash
   python app.py
   ```

5. Open **http://localhost:5000** in your browser.

---

## Dataset

The benchmark dataset of **89 runs and 267 individual model responses** is included
as `promptarena_results_2026-09-07.csv`. For each response it records the prompt,
task category, model, response time (ms), token usage, rule-based score,
LLM-as-Judge score and the winning model for the run.

---

## Scoring

Each response receives a rule-based score computed as:

```
Overall Score = 0.35(Substance) + 0.25(Clarity) + 0.20(Completeness) + 0.20(Reliability)
```

The **Completeness** dimension applies diminishing returns beyond a sufficiency
threshold, so that excessive length is not rewarded, countering the verbosity bias
common to automated evaluators. A separate **LLM-as-Judge** scores the same responses
semantically, and both scores are stored side by side to allow their agreement and
disagreement to be examined.

---

## Author

**Mariam Haroon**, MSc Artificial Intelligence, Aston University (2025 to 2026)
GitHub: [mariamharoon17](https://github.com/mariamharoon17)

---

## Note on API keys

API keys are **not** included in this repository and must be supplied by the user in
a `.env` file. Usage of the OpenAI, Anthropic and Google APIs is subject to each
provider's terms and pricing.
