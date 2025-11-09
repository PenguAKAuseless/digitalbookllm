# Document Sources for DigitalBookLLM Dataset

This document lists all the source materials configured for the synthetic dataset generation pipeline.

## Overview

The pipeline is designed to generate training data from **11 diverse documents** across 4 major categories:

- **3** Humanities & Philosophy texts
- **3** STEM resources  
- **3** Social Sciences materials
- **2** Technical Documentation sources

---

## 📚 Complete Document List

### Humanities & Philosophy

| Document | Field | Source | Status |
|----------|-------|--------|--------|
| **The Republic** (Plato) | Philosophy | [Project Gutenberg](https://www.gutenberg.org/ebooks/1497.txt.utf-8) | ✅ Auto-download |
| **Leviathan** (Thomas Hobbes) | Political Philosophy | [Project Gutenberg](https://www.gutenberg.org/ebooks/3207.txt.utf-8) | ✅ Auto-download |
| **Meditations** (Marcus Aurelius) | Philosophy (Stoicism) | [Project Gutenberg](https://www.gutenberg.org/ebooks/2680.txt.utf-8) | ✅ Auto-download |

### STEM

| Document | Field | Source | Status |
|----------|-------|--------|--------|
| **Biology 2e** | Biology | [OpenStax](https://openstax.org/books/biology-2e/pages/1-introduction) | ⚠️ Manual download required |
| **College Physics 2e** | Physics | [OpenStax](https://openstax.org/books/college-physics-2e/pages/1-introduction) | ⚠️ Manual download required |
| **Attention Is All You Need** | Computer Science (AI/ML) | [arXiv](https://arxiv.org/html/1706.03762v7) | ⚠️ Manual download required |

### Social Sciences

| Document | Field | Source | Status |
|----------|-------|--------|--------|
| **Psychology 2e** | Psychology | [OpenStax](https://openstax.org/books/psychology-2e/pages/1-introduction) | ⚠️ Manual download required |
| **Principles of Economics 3e** | Economics | [OpenStax](https://openstax.org/books/principles-economics-3e/pages/1-introduction) | ⚠️ Manual download required |
| **Roman Republic** (Wikipedia) | History | [Wikipedia](https://en.wikipedia.org/wiki/Roman_Republic) | ⚠️ Manual download required |

### Technical Documentation

| Document | Field | Source | Status |
|----------|-------|--------|--------|
| **LangChain RAG Tutorial** | Computer Science (Software) | [LangChain Docs](https://python.langchain.com/v0.2/docs/tutorials/rag/) | ⚠️ Manual download required |
| **Hugging Face Transformers** | Computer Science (Software) | [HF Docs](https://huggingface.co/docs/transformers/en/index) | ⚠️ Manual download required |

---

## 🚀 Quick Start

### 1. Auto-Download (Project Gutenberg)

The notebook will automatically download the 3 Gutenberg texts when you run the download cell.

### 2. Manual Downloads

For sources requiring manual download, follow these instructions:

#### **OpenStax Books** (4 books)
```bash
# Option 1: Download PDF from website, then convert to text
# Visit each book URL, click "Download" → "PDF"

# Option 2: Use web scraping (requires BeautifulSoup)
pip install beautifulsoup4 requests
# Then write a scraper or use existing OpenStax scrapers
```

#### **arXiv Papers** (1 paper)
```bash
# Download PDF
wget https://arxiv.org/pdf/1706.03762.pdf

# Convert to text
pip install PyPDF2
python -c "
import PyPDF2
with open('1706.03762.pdf', 'rb') as f:
    reader = PyPDF2.PdfReader(f)
    text = ''.join([page.extract_text() for page in reader.pages])
    with open('./docs/attention_is_all_you_need.txt', 'w') as out:
        out.write(text)
"
```

#### **Wikipedia Articles** (1 article)
```bash
pip install wikipedia-api

python -c "
import wikipediaapi
wiki = wikipediaapi.Wikipedia('en')
page = wiki.page('Roman_Republic')
with open('./docs/roman_republic.txt', 'w', encoding='utf-8') as f:
    f.write(page.text)
"
```

#### **Documentation Sites** (2 sources)
```bash
# Option 1: Manual copy-paste from browser
# Option 2: Use wget or curl to save HTML, then extract text
# Option 3: Use site-specific APIs or scrapers
```

---

## 📊 Expected Output

After running `create_dataset.ipynb`, you will have:

```
./docs/
├── the_republic.txt              ✅ Auto-downloaded
├── leviathan.txt                 ✅ Auto-downloaded  
├── meditations.txt               ✅ Auto-downloaded
├── biology_2e.txt                ⚠️ Manual
├── college_physics_2e.txt        ⚠️ Manual
├── attention_is_all_you_need.txt ⚠️ Manual
├── psychology_2e.txt             ⚠️ Manual
├── principles_of_economics_3e.txt⚠️ Manual
├── roman_republic.txt            ⚠️ Manual
├── langchain_rag_docs.txt        ⚠️ Manual
└── huggingface_transformers_docs.txt ⚠️ Manual

./dataset_the_republic/           # Generated dataset
./dataset_leviathan/              # Generated dataset
./dataset_meditations/            # Generated dataset
... (and so on for each document)
```

---

## ⚙️ Configuration

All document sources are defined in `create_dataset.ipynb`, Cell 4:

```python
DOC_SOURCES = [
    {
        "name": "the_republic",
        "url": "https://www.gutenberg.org/ebooks/1497.txt.utf-8",
        "field": "Philosophy"
    },
    # ... etc
]
```

To add more documents:
1. Add a new entry to the `DOC_SOURCES` list
2. Specify the `type` field for special handling: `"gutenberg"`, `"openstax"`, `"arxiv"`, `"wikipedia"`, or `"web"`
3. Manually download if needed and save to `./docs/`

---

## 🎯 Dataset Generation Parameters

- **Examples per document:** 500 (configurable via `EXAMPLES_PER_DOC`)
- **Quality threshold:** 4.5/5.0 (configurable via `SCORE_THRESHOLD`)
- **Generation strategies:** 3 (Search Mode, Tutor-Ask, Tutor-Query)
- **Teacher model:** `meta-llama/Llama-3.3-70B-Instruct-Turbo-Free`

---

## 📝 Notes

- The pipeline will **skip** any documents that haven't been downloaded yet
- Only documents in `./docs/` with valid content will be processed
- Each document generates a separate dataset in `./dataset_{name}/` format
- Datasets are saved in compressed Arrow format for efficient loading during fine-tuning

---

## ✅ Next Steps

1. Run the document download cell in `create_dataset.ipynb`
2. Manually download the remaining 8 sources (see instructions above)
3. Run the dataset generation pipeline
4. Proceed to `finetune.ipynb` for model training
