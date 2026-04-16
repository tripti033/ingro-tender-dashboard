# Local LLM Setup — Ollama

The scraper can optionally use a **local LLM (via Ollama)** to:

1. **Fill gaps in regex parsing** — when a tender title uses unusual wording, the LLM extracts `powerMW`, `energyMWh`, `category`, `authority`, `location`, etc.
2. **Parse bid document PDFs** — extracts rich Technical + Financial fields (min bid size, RTE, daily cycles, EMD, VGF, SCOD, etc.) from downloaded RfS/RfP PDFs.

The scraper works **without** Ollama — it falls back to regex-only parsing. LLM is purely additive.

---

## Install Ollama on Mac (M1/M2/M3/M4)

```bash
# 1. Install Ollama
brew install ollama

# 2. Start the Ollama server (leave running in a terminal)
ollama serve

# 3. In a new terminal, pull a model
ollama pull llama3.2:3b   # ~2 GB, fastest, good for field extraction
# or
ollama pull qwen2.5:7b    # ~4.7 GB, slower, best quality
# or
ollama pull phi3.5:3.8b   # ~2.2 GB, fast, Microsoft's model
```

---

## Run the Scraper with LLM

Once Ollama is running, the scraper auto-detects it:

```bash
# Runs with LLM fallback
node scraper/index.js
```

To use a different model:

```bash
OLLAMA_MODEL=qwen2.5:7b node scraper/index.js
```

If Ollama is NOT running, you'll see:

```
[LLM] Ollama not running — falling back to regex parsing
```

And the scraper continues normally with regex only.

---

## Enrich Existing Tenders from PDFs

The `pdf-parser.js` script downloads each tender's PDF document, extracts text, and uses the LLM to fill in Technical + Financial fields.

### Install pdf-parse (one-time)

```bash
npm install pdf-parse
```

### Run for all tenders with PDFs

```bash
node scraper/pdf-parser.js
```

### Run for a specific tender

```bash
node scraper/pdf-parser.js SECI-2025-TN000023
```

The script only fills in **missing** fields — it never overwrites values you've manually edited on the dashboard.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.2:3b` | Model to use |

---

## Which Model to Use?

| Model | Size | RAM | Speed (M2) | Best for |
|---|---|---|---|---|
| **llama3.2:3b** ⭐ | 2 GB | 4 GB | ~40 tok/s | **Recommended default** — fast, good accuracy |
| **phi3.5:3.8b** | 2.2 GB | 4 GB | ~50 tok/s | Slightly faster, similar quality |
| **qwen2.5:7b** | 4.7 GB | 8 GB | ~20 tok/s | Best quality for PDF parsing |
| **llama3.1:8b** | 4.7 GB | 8 GB | ~18 tok/s | Well-tested, good for complex docs |

Start with `llama3.2:3b`. If accuracy is insufficient for PDFs, upgrade to `qwen2.5:7b`.

---

## GitHub Actions (Production)

**Don't run LLM in GitHub Actions cron.** The free runner only has 7 GB RAM and no GPU — model loading alone takes 3-5 minutes per run. The scraper falls back to regex automatically, so GitHub Actions keeps working fine without LLM.

Use the LLM **locally on your Mac** for:
- Bulk re-parsing existing tenders (`pdf-parser.js`)
- Testing new tender sources without writing parsers
- Cleanup runs when you notice bad data

---

## Troubleshooting

**"Ollama is running but model not found"**
→ Run `ollama list` to see installed models. Pull the missing one with `ollama pull <model>`.

**LLM timeout errors**
→ Model is too large for your Mac, or first call is loading the model. Try a smaller model or wait.

**PDF parsing fails**
→ Make sure `pdf-parse` is installed: `npm install pdf-parse`

**"auth/invalid-credential" on pdf-parser.js**
→ Check `FIREBASE_SCRAPER_EMAIL` and `FIREBASE_SCRAPER_PASSWORD` in `.env`
