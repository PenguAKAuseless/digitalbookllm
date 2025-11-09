# 1. System Structure and Architecture

The core idea is to move beyond a standard RAG pipeline (Query -> Retrieve -> Augment -> Generate) to an **Adaptive RAG Pipeline**. This system intelligently handles two user scenarios:

1. **Prioritized RAG (Tutor Mode):** When a user provides both a `query` AND `selected_text`. The system synthesizes a conversational answer anchored to the user's selection as the primary context.
2. **Standard RAG (Search Mode):** When a user provides *only* a `query`. The system searches the entire document for a general, grounded answer.

The user's `selected_text` (when provided) is the primary source of truth, ensuring context-aware responses. This 'agentic' routing makes the system flexible for both targeted tutoring and broad exploration.

Here's the high-level data flow:

* **Intake (One-Time):** A user uploads or pastes a document (the "source").
* **Indexing:** The document is split into manageable chunks (e.g., paragraphs or fixed-size overlapping chunks using `RecursiveCharacterTextSplitter`).
* **Embedding:** Each chunk is converted into a vector embedding using a lightweight model (e.g., `all-MiniLM-L6-v2` from Sentence Transformers).
* **Storage:** Embeddings and raw text chunks are stored in a Vector Database (e.g., FAISS for in-memory speed).
* **Query (Runtime):** The user provides a `query` (string) and optionally `selected_text` (string).
* **Adaptive Retrieval:**
    * **Tutor Mode:** `selected_text` is the "Primary Context." Embed `query + selected_text` to retrieve top-K similar chunks as "Augmented Context," with de-duplication to avoid redundancy.
    * **Search Mode:** Embed only the `query` to retrieve top-K chunks as standard "Context."
* **Prompt Construction:** Build mode-specific prompts that delineate context types and instruct the LLM on synthesis (Tutor Mode) or direct grounding (Search Mode).
* **Generation:** The LLM (e.g., via Together AI, model like `meta-llama/Llama-3.3-70B-Instruct-Turbo-Free`) generates the response.

This pipeline is implemented in a Jupyter notebook for prototyping, with examples demonstrating both modes.

---

# 2. Database

For this system, you need two types of storage:

* **Source Document Store:** A simple database (like SQLite or even a JSON file for this demo) that stores the full, original documents (e.g., `doc_id: 123`, `doc_name: "Physics_Notes.pdf"`, `full_text: "..."`).
* **Vector Database:** This is the heart of the retrieval system.
    * **Choice:** For a local, fast implementation, **FAISS** (Facebook AI Similarity Search) is excellent. It's an in-memory library, perfect for prototyping in a `.ipynb`. For a more persistent, scalable solution, you'd use **ChromaDB** or **LanceDB**.
    * **Schema:** Each entry in the vector store would consist of:
        * Vector Embedding: The high-dimensional vector (e.g., dimension 384 for `all-MiniLM-L6-v2`).
        * Metadata: A dictionary containing:
            * `source_doc_id`: To link back to the original document.
            * `chunk_id`: The 0-indexed number of this chunk within the document.
            * `text`: The raw text of the chunk itself.

In the notebook implementation:
- Documents are loaded from files (e.g., via `gdown` for Gutenberg texts).
- Chunks are created with overlap (e.g., `chunk_size=1000`, `chunk_overlap=150`).
- Embeddings are generated and added to a `faiss.IndexFlatL2` index.

---

# 3. Agentic & RAG Workflow (Adaptive RAG)

This is the "agentic" part. The system routes dynamically based on input, making instructed decisions on context handling.

**Workflow:**

* **Input:** `query` (string), `selected_text` (string or None), `top_k` (int, default=3).
* **Adaptive Routing:**
    * If `selected_text` is provided: Enter **Tutor Mode (Prioritized RAG)**.
    * If `selected_text` is None: Enter **Search Mode (Standard RAG)**.
* **Retrieval (Both Modes):**
    * Embed the search query (`query + selected_text` for Tutor Mode; `query` for Search Mode).
    * Use FAISS to search for top-K most similar chunks (L2 distance).
* **Context De-duplication (Tutor Mode Only):**
    * Discard any retrieved chunk identical to `selected_text` to prevent redundancy.
* **Prompt Engineering (The "Agentic" Instruction):**
    * **Tutor Mode:** A synthesizing prompt anchors on `[USER'S SELECTION]` (the `selected_text`), weaves in `[RELATED CONTEXT]` naturally, and responds conversationally to the `[USER QUESTION]`. Instructs: "Ground your answer in the [USER'S SELECTION]... Naturally synthesize... Do not use robotic phrases."
    * **Search Mode:** A standard prompt grounds the response *only* on `[CONTEXT]` (retrieved chunks), keeping it clear and concise.
* **Generation:** Call the LLM with low temperature (0.2) and max tokens (750) for concise, grounded outputs.

The core logic is encapsulated in a single function `run_adaptive_rag`, which handles routing, retrieval, prompt building, and LLM invocation.

---

# 4. Running Examples

The notebook includes practical examples to demonstrate both modes using *Alice's Adventures in Wonderland* as the source document.

* **Example 1 (Tutor Mode - Direct Answer):**  
  `selected_text`: "The rabbit-hole went straight on like a tunnel..."  
  `query`: "What happened to Alice at the rabbit-hole, and what did it seem like?"  
  *Expected:* Response anchored to selection, e.g., "Alice tumbled down a deep well after chasing the White Rabbit."

* **Example 2 (Tutor Mode - Synthesis Needed):**  
  `selected_text`: "Soon her eye fell on a little glass box... 'EAT ME'..."  
  `query`: "What was the plan for the 'EAT ME' cake?"  
  *Expected:* Synthesizes from related chunks (e.g., Alice eats it to grow/shrink), weaving selection and context seamlessly.

* **Example 3 (Tutor Mode - Distant Query):**  
  `selected_text`: Text about the Rabbit's waistcoat.  
  `query`: "What did Alice find on the table in the great hall?"  
  *Expected:* Ignores irrelevant selection; uses retrieved context (e.g., golden key) for a grounded answer.

* **Example 4 (Search Mode - General Query):**  
  `query`: "What was the Mock Turtle's story about?" (No selection).  
  *Expected:* Retrieves relevant chunks on the Mock Turtle's tale, providing a concise summary.

These examples show mode switching, de-duplication, and natural synthesis in action.

---

# 5. Scoring and Metrics

To evaluate the adaptive system, use metrics tailored to each mode.

### Retrieval Metrics (Both Modes)
* **Context Precision @ K:** Of the K retrieved chunks, what fraction are relevant to the query? (Manual or LLM-judged; target >80%).

### Generation Metrics (The RAG Triad, Adapted)
1. **Faithfulness (Groundedness):** Is the answer fully supported by the provided context(s)? No hallucinations? (Applies to both; target 90%+ via LLM-as-judge).
2. **Answer Relevance:** Does the answer directly and completely address the query? (Applies to both; target 85%+).
3. **Synthesis Quality (Tutor Mode Only):** Does the answer naturally weave User's Selection and Related Context into a cohesive, non-robotic explanation? (Target 80%+ for conversational flow).