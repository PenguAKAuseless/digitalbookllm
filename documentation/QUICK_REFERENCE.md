# 🚀 DigitalBookLLM Quick Reference

## 🎯 Local Distillation Workflow

```
Stage 1: DATA GENERATION (Local Teacher)          Stage 2: FINE-TUNING (Student)
┌─────────────────────────────────┐              ┌──────────────────────────────┐
│                                 │              │                              │
│  📚 11 Documents                │              │  📊 Synthetic Datasets       │
│         ↓                       │              │         ↓                    │
│  🤖 Teacher Model (70B, 4-bit)  │    ═══>     │  🎓 Student Model (7B)       │
│         ↓                       │              │         ↓                    │
│  ⚖️  LLM-as-a-Judge             │              │  📈 QLoRA Training           │
│         ↓                       │              │         ↓                    │
│  💾 Filtered Datasets           │              │  ✅ Distilled Model          │
│     (2,000-4,000 examples)      │              │     (10x smaller/faster)     │
│                                 │              │                              │
└─────────────────────────────────┘              └──────────────────────────────┘
    8-12 hours | 40-50GB VRAM                         3-5 hours | 16-24GB VRAM
```

## 🎯 Current Status

### ✅ Documents Added: 11 Total

| Category | Count | Files |
|----------|-------|-------|
| Humanities & Philosophy | 3 | The Republic, Leviathan, Meditations |
| STEM | 3 | Biology 2e, Physics 2e, Attention Paper |
| Social Sciences | 3 | Psychology 2e, Economics 3e, Roman Republic |
| Technical Docs | 2 | LangChain, Hugging Face |

### 📊 Auto vs Manual

- **Auto-Download**: 3 documents (Project Gutenberg) ✅
- **Manual Required**: 8 documents (OpenStax, arXiv, Wikipedia, Web) ⚠️

## ⚡ Quick Commands

### Download Documents
```bash
# Option 1: Run helper script
python download_helpers.py

# Option 2: In notebook
# Run cell "4.5 Document Download Helpers"
```

### Check Status
```python
# Run cell "4.7 Check Document Status"
# Shows which documents are ready
```

### Generate Datasets
```python
# Run all cells in create_dataset.ipynb
# Or just run from "8. Main Processing Loop"
```

### Fine-tune Model
```python
# After datasets are generated:
# Run all cells in finetune.ipynb
```

## 📂 File Structure

```
digitalbookllm/documentation/
├── create_dataset.ipynb          # Step 1: Generate training data
├── finetune.ipynb                 # Step 2: Train the model
├── download_helpers.py            # Helper script for downloads
├── DOCUMENT_SOURCES.md            # Full documentation
├── INTEGRATION_COMPLETE.md        # Setup summary
├── priority-rag.md                # RAG system design
├── finetune.md                    # Fine-tuning strategy
│
├── docs/                          # Downloaded source documents
│   ├── the_republic.txt
│   ├── leviathan.txt
│   └── ... (11 total)
│
├── dataset_*/                     # Generated datasets (Arrow format)
│   ├── dataset_the_republic/
│   ├── dataset_leviathan/
│   └── ... (11 total)
│
└── final_models/                  # Fine-tuned models
    ├── model_mask_*/              # LoRA adapters
    └── final_merged_model_*/      # Merged models
```

## 🔧 Configuration Quick Edit

All in `create_dataset.ipynb`, Cell 4:

```python
# Quality threshold (1.0 - 5.0)
SCORE_THRESHOLD = 4.5  # Higher = better quality, fewer examples

# Examples per document
EXAMPLES_PER_DOC = 500  # More = longer processing, more data

# Retrieval chunks
TOP_K = 3  # Context chunks to retrieve

# Teacher model
TEACHER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free"
```

## 📈 Expected Processing Time

| Stage | Time (per doc) | Total (11 docs) |
|-------|----------------|-----------------|
| Download | 1-5 min | ~30 min |
| Dataset Generation | 30-60 min | ~8 hours |
| Fine-tuning | 10-30 min | ~3 hours |

*Note: Times vary based on document size, API speed, and GPU.*

## 💡 Pro Tips

1. **Start Small**: Begin with the 3 auto-downloaded Gutenberg texts
2. **Test First**: Generate just 50 examples per doc initially (`EXAMPLES_PER_DOC = 50`)
3. **Monitor Quality**: Check the `last_score` in the progress bar
4. **Save API Costs**: Lower `SCORE_THRESHOLD` to 4.0 to reduce LLM calls
5. **Incremental Training**: Fine-tune on one dataset, test, then add more

## 🐛 Common Issues

| Problem | Solution |
|---------|----------|
| "No module named 'together'" | `pip install together` |
| "API key not found" | Set `TOGETHER_API_KEY` in .env or enter when prompted |
| "Document not found" | Check `./docs/` directory exists and has .txt files |
| "Low quality scores" | Normal - only ~40-60% pass threshold |
| "Out of memory" | Reduce `EXAMPLES_PER_DOC` or use smaller model |

## 📚 Documentation

- **Full Guide**: `DOCUMENT_SOURCES.md`
- **RAG Design**: `priority-rag.md`
- **Training Strategy**: `finetune.md`
- **This Reference**: `QUICK_REFERENCE.md`

## 🎯 Next Actions

- [ ] Run `python download_helpers.py`
- [ ] Check status with Cell 4.7
- [ ] Run `create_dataset.ipynb` (start to finish)
- [ ] Review generated datasets in `dataset_*/`
- [ ] Run `finetune.ipynb` to train model
- [ ] Test the fine-tuned model

---

**Questions?** Check the detailed docs or the notebook markdown cells for help!
