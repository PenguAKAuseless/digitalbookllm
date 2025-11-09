# Fine-Tuning "DigitalBookLLM" for Adaptive RAG

## 1. Objective

The primary goal of this fine-tuning process is to "distill" the knowledge of a larger, powerful local **"teacher" model** (e.g., `meta-llama/Llama-3.1-70B-Instruct` or `Qwen/Qwen2.5-72B-Instruct`) into a smaller, faster, and more efficient **"student" model** (e.g., `Mistral-7B-Instruct-v0.3` or `Phi-3-medium-4k-instruct`).

**Key Advantages of Local Teacher Model:**
- **No API Costs:** Eliminate per-token charges from cloud providers
- **Full Control:** Control generation parameters, prompts, and filtering
- **Privacy:** Keep all training data local
- **Reproducibility:** Consistent results across runs
- **Scalability:** Generate unlimited training examples without rate limits

This student model will be specialized to handle the two specific modes of the **Adaptive RAG** system:
1.  **Search Mode:** Answering general questions based on retrieved context.
2.  **Tutor Mode:** Synthesizing conversational answers anchored to a user's `selected_text`.

## 2. Data Sourcing Strategy

To ensure the model generalizes well, the synthetic dataset will be generated from a diverse corpus of academic and technical documents.

| Category | Source Examples | Rationale |
| --- | --- | --- |
| **STEM** | **OpenStax:** *Biology 2e*, *Physics* | Structured textbook content, diagrams, definitions. |
| | **arXiv:** Papers on CS (e.g., "Attention Is All You Need") | Dense, technical, novel concepts. |
| **Humanities** | **Project Gutenberg:** *Leviathan*, *The Republic* | Complex argumentation, abstract concepts, varied prose. |
| **Social Sciences**| **Wikipedia:** Featured articles on *Economic History*, *Psychology* | Broad, well-summarized general knowledge. |
| **Technical Docs** | **LangChain / Hugging Face Docs** | Instructional, code-heavy, practical "how-to" steps. |

## 3. Synthetic Data Generation Strategy

We will generate `(prompt, completion)` pairs that precisely mimic the final prompts sent to the LLM in the `run_adaptive_rag` function. We will generate examples for all user behaviors.

### Strategy 1: "Search Mode" (General Q&A)

* **User Behavior:** User provides only a `query`.
* **Generation Process:**
    1.  Randomly select a document chunk.
    2.  **Teacher LLM:** Generate a question that this chunk can answer.
    3.  **RAG Pipeline:** Use this generated question to perform a *standard RAG search* (as in `run_adaptive_rag` with `selected_text=None`) to retrieve the `top_k` chunks.
    4.  **Format:** Create the "Search Mode" prompt template using these `top_k` chunks as `[CONTEXT]`.
    5.  **Teacher LLM:** Generate the "golden" answer based on this prompt.

### Strategy 2: "Tutor Mode - Asking" (Selection + Question)

* **User Behavior:** User provides `selected_text` AND a `query`.
* **Generation Process:**
    1.  Randomly select a chunk to act as `[USER'S SELECTION]`.
    2.  **Teacher LLM:** Generate a specific question *about* this selection.
        * *Explanation Query:* "Can you explain this part about [topic] in simpler terms?"
        * *Synthesis Query:* "How does this selection relate to [other concept in the doc]?"
        * *Analysis Query:* "What are the main implications of this statement?"
    3.  **RAG Pipeline:** Use the `query + selected_text` to perform an *augmented retrieval* to get `top_k` *related* chunks.
    4.  **Format:** Create the "Tutor Mode" prompt template with `[USER'S SELECTION]` and `[RELATED CONTEXT]`.
    5.  **Teacher LLM:** Generate the "golden" synthesized answer.

### Strategy 3: "Tutor Mode - Querying" (Selection, No Question)

* **User Behavior:** User provides `selected_text` but **no** `query`. This implies a request for "tell me more" or "summarize."
* **Generation Process:**
    1.  Randomly select a chunk to act as `[USER'S SELECTION]`.
    2.  **Implicit Query:** Create a "hidden" query for the user, e.g., "Summarize this selection" or "Elaborate on this point."
    3.  **RAG Pipeline:** Use the `implicit_query + selected_text` for augmented retrieval.
    4.  **Format:** Create the "Tutor Mode" prompt, using the *implicit query* as the `[USER QUESTION]`.
    5.  **Teacher LLM:** Generate the "golden" summary or elaboration.

## 4. Scoring & Filtering

To ensure dataset quality, every generated `(prompt, completion)` pair will be "judged" by the teacher model.

An `LLM-as-a-Judge` prompt will be used to score each completion on a 1-5 scale across four metrics:

1.  **Faithfulness (Groundedness):** (Weight: 40%) Is the answer 100% supported by the *provided contexts* (`[USER'S SELECTION]` and/or `[RELATED CONTEXT]`)? (1=Hallucinated, 5=Perfectly Grounded)
2.  **Query Relevance:** (Weight: 30%) Does the answer *directly and completely* address the `[USER QUESTION]`? (1=Irrelevant, 5=Perfectly Relevant)
3.  **Synthesis Quality (Tutor Mode Only):** (Weight: 15%) Does the answer *naturally weave* the `[USER'S SELECTION]` and `[RELATED CONTEXT]`? (1=Robotic, 5=Seamless Synthesis)
4.  **Clarity & Conciseness:** (Weight: 15%) Is the answer easy to understand, non-robotic, and free of fluff? (1=Confusing, 5=Clear and Concise)

**Final Score Calculation:**
`Total_Score = (Faithfulness * 0.4) + (Query Relevance * 0.3) + (Synthesis * 0.15) + (Clarity * 0.15)`

**Filtering Threshold:**
Only pairs with a **`Total_Score >= 4.5 / 5.0`** will be saved to the fine-tuning dataset.

## 5. Local Model Architecture

### Teacher Model (Data Generation)
* **Model Options:**
    * `meta-llama/Llama-3.1-70B-Instruct` (Recommended for quality)
    * `Qwen/Qwen2.5-72B-Instruct` (Excellent reasoning)
    * `mistralai/Mixtral-8x7B-Instruct-v0.1` (Good balance)
* **Quantization:** 4-bit (AWQ or GPTQ) or 8-bit for memory efficiency
* **Purpose:** Generate synthetic training data and judge quality
* **Loading:** Use `transformers` with `device_map="auto"` for multi-GPU
* **Inference:** vLLM or HF Transformers for fast generation

### Student Model (Fine-Tuning Target)
* **Model Options:**
    * `Mistral-7B-Instruct-v0.3` (Fast, efficient)
    * `microsoft/Phi-3-medium-4k-instruct` (Excellent small model)
    * `Qwen/Qwen2.5-7B-Instruct` (Strong reasoning)
* **Technique:** **QLoRA** (4-bit Quantization + Low-Rank Adaptation)
* **Libraries:** Hugging Face `transformers`, `peft`, `bitsandbytes`, `accelerate`, `trl`

## 6. Fine-Tuning Strategy

* **Dataset Format:** Arrow format (via Hugging Face `datasets`), with `{"prompt": "...", "completion": "..."}` structure
* **Chat Template:** Wrapped in model-specific format (e.g., `<s>[INST] {prompt} [/INST] {completion} </s>`)
* **Key LoRA Parameters:**
    * `r: 16` (rank)
    * `lora_alpha: 32`
    * `lora_dropout: 0.05`
    * `target_modules`: `[q_proj, k_proj, v_proj, o_proj]`
* **Training Strategy:**
    * **Sequential Training:** One document-dataset at a time
    * **Evaluation After Each:** Measure performance on held-out test set
    * **Rollback on Regression:** Keep only improvements
    * **Bitmask Tracking:** Track which datasets improved the model (e.g., `1011`)

## 7. Hardware Requirements

### For Dataset Generation (Teacher Model)
- **Minimum:** 1x RTX 3090 (24GB) or 1x A6000 (48GB)
- **Recommended:** 2x RTX 4090 (48GB total) or 1x A100 (80GB)
- **Quantization:** 4-bit for 70B models, 8-bit for 7B-30B models

### For Fine-Tuning (Student Model)
- **Minimum:** 1x RTX 3090 (24GB)
- **Recommended:** 1x RTX 4090 (24GB) or A6000 (48GB)
- **QLoRA enables:** Training 7B models on 16GB+ GPUs