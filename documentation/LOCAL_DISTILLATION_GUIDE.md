# Local Model Distillation Guide

## Overview

This guide explains how to use **local-to-local knowledge distillation** to create a specialized RAG model without relying on API services.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    STAGE 1: DATA GENERATION                  │
│                                                               │
│  ┌──────────────────┐         ┌─────────────────┐           │
│  │  Source Docs     │  ───>   │  Teacher Model  │           │
│  │  (11 diverse)    │         │  (70B, 4-bit)   │           │
│  └──────────────────┘         └────────┬────────┘           │
│                                         │                     │
│                                         ▼                     │
│                              ┌──────────────────┐            │
│                              │  Synthetic Data  │            │
│                              │  + LLM Judge     │            │
│                              └────────┬─────────┘            │
│                                       │                       │
│                                       ▼                       │
│                              ┌──────────────────┐            │
│                              │ High-Quality     │            │
│                              │ Dataset (Arrow)  │            │
│                              └──────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                                       │
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    STAGE 2: FINE-TUNING                      │
│                                                               │
│  ┌──────────────────┐         ┌─────────────────┐           │
│  │ Synthetic Data   │  ───>   │  Student Model  │           │
│  │ (Filtered)       │         │  (7B, QLoRA)    │           │
│  └──────────────────┘         └────────┬────────┘           │
│                                         │                     │
│                                         ▼                     │
│                              ┌──────────────────┐            │
│                              │  Evaluate        │            │
│                              │  (Test Set)      │            │
│                              └────────┬─────────┘            │
│                                       │                       │
│                              ┌────────▼─────────┐            │
│                              │  Keep/Rollback   │            │
│                              │  Decision        │            │
│                              └────────┬─────────┘            │
│                                       │                       │
│                                       ▼                       │
│                              ┌──────────────────┐            │
│                              │ Final Distilled  │            │
│                              │ Model (7B)       │            │
│                              └──────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Model Selection

### Teacher Model (Data Generation)

| Model | Size | Memory (4-bit) | Speed | Quality | Recommendation |
|-------|------|----------------|-------|---------|----------------|
| **Llama-3.1-70B-Instruct** | 70B | ~40GB | Medium | Excellent | ⭐ Best overall |
| **Qwen2.5-72B-Instruct** | 72B | ~42GB | Medium | Excellent | Strong reasoning |
| **Mixtral-8x7B-Instruct** | 47B | ~28GB | Fast | Very Good | Budget option |

**Requirements:**
- VRAM: 40-50GB (1x A100 80GB or 2x RTX 4090)
- Quantization: 4-bit NF4 recommended
- Batch size: 1-2 for generation

### Student Model (Fine-Tuning Target)

| Model | Size | Memory (QLoRA) | Speed | Recommendation |
|-------|------|----------------|-------|----------------|
| **Mistral-7B-Instruct-v0.3** | 7B | ~16GB | Very Fast | ⭐ Best balanced |
| **Phi-3-medium-4k** | 14B | ~20GB | Fast | High quality |
| **Qwen2.5-7B-Instruct** | 7B | ~16GB | Very Fast | Strong reasoning |

**Requirements:**
- VRAM: 16-24GB (1x RTX 3090 or better)
- QLoRA: 4-bit quantization + LoRA adapters
- Batch size: 2-4 with gradient accumulation

## Hardware Requirements

### Minimum Setup
- **GPU:** 1x RTX 3090 (24GB) or 1x A6000 (48GB)
- **RAM:** 32GB system RAM
- **Storage:** 200GB free (for models + datasets)
- **Can run:** Teacher OR Student (swap between stages)

### Recommended Setup
- **GPU:** 2x RTX 4090 (48GB total) or 1x A100 (80GB)
- **RAM:** 64GB system RAM
- **Storage:** 500GB SSD
- **Can run:** Teacher AND Student simultaneously

### Optimal Setup
- **GPU:** 1x A100 80GB or 2x A6000 (96GB total)
- **RAM:** 128GB system RAM
- **Storage:** 1TB NVMe SSD
- **Can run:** Everything with room to spare

## Step-by-Step Workflow

### Stage 1: Generate Training Data

1. **Choose Teacher Model**
   ```python
   TEACHER_MODEL_NAME = "meta-llama/Llama-3.1-70B-Instruct"
   TEACHER_QUANTIZATION = "4bit"  # Fit on 40GB VRAM
   ```

2. **Prepare Documents**
   - Download/prepare 11 source documents
   - Run document download cells
   - Verify with status check cell

3. **Load Teacher Model**
   - Auto-quantizes to 4-bit
   - Distributes across GPUs if available
   - Takes ~5-10 minutes to load

4. **Generate Datasets**
   - 500 examples per document (configurable)
   - 3 generation strategies (Search, Tutor-Ask, Tutor-Query)
   - LLM-as-Judge filters examples
   - Only keeps scores ≥ 4.5/5.0

5. **Output**
   - `./dataset_the_republic/`
   - `./dataset_leviathan/`
   - ... (11 total dataset directories)
   - Each contains 200-400 high-quality pairs

**Time Estimate:** 8-12 hours for all 11 documents (depends on GPU)

### Stage 2: Fine-Tune Student Model

1. **Choose Student Model**
   ```python
   BASE_MODEL_NAME = "mistralai/Mistral-7B-Instruct-v0.3"
   ```

2. **Prepare Environment**
   - Clear GPU memory from teacher model
   - Load student with QLoRA config
   - Set up training arguments

3. **Sequential Training**
   - Train on dataset 1 → Evaluate → Keep/Rollback
   - Train on dataset 2 → Evaluate → Keep/Rollback
   - ... repeat for all datasets
   - Bitmask tracks successful datasets

4. **Output**
   - `./final_models/model_mask_11111111111/` (LoRA adapters)
   - `./final_models/final_merged_model_*/` (Merged model)

**Time Estimate:** 3-5 hours for all datasets (depends on GPU)

## Configuration Options

### Dataset Generation

```python
# Quality vs Quantity
SCORE_THRESHOLD = 4.5   # Higher = better quality, fewer examples
EXAMPLES_PER_DOC = 500  # More = longer processing, more data

# Teacher model
TEACHER_MODEL_NAME = "meta-llama/Llama-3.1-70B-Instruct"
TEACHER_QUANTIZATION = "4bit"  # 4bit, 8bit, or none

# Generation parameters
TOP_K = 3  # Context chunks to retrieve
```

### Fine-Tuning

```python
# LoRA parameters
r = 16              # Rank (higher = more parameters)
lora_alpha = 32     # Alpha (typically 2*r)
lora_dropout = 0.05 # Dropout

# Training parameters
per_device_train_batch_size = 2  # Batch size per GPU
gradient_accumulation_steps = 4   # Effective batch = 2*4 = 8
learning_rate = 2e-4              # Learning rate
num_train_epochs = 1              # Epochs per dataset
```

## Memory Optimization Tips

### For Teacher Model (Data Generation)

1. **Use 4-bit Quantization**
   ```python
   TEACHER_QUANTIZATION = "4bit"
   ```
   - 70B model: ~40GB instead of ~140GB
   - Minimal quality loss

2. **Reduce Batch Size**
   - Generate examples one at a time
   - Clear cache between batches

3. **Multi-GPU Distribution**
   ```python
   device_map="auto"  # Automatically splits across GPUs
   ```

### For Student Model (Fine-Tuning)

1. **Use QLoRA**
   - 4-bit base model + LoRA adapters
   - Train 7B on 16GB GPU

2. **Gradient Accumulation**
   ```python
   gradient_accumulation_steps = 4
   ```
   - Effective larger batch without memory cost

3. **Gradient Checkpointing**
   ```python
   gradient_checkpointing = True
   ```
   - Trades compute for memory

## Quality Control

### Dataset Generation
- **LLM-as-a-Judge:** Scores each example on 4 metrics
- **Threshold Filtering:** Only keeps scores ≥ 4.5/5.0
- **Expected Pass Rate:** 40-60% of generated examples
- **Manual Review:** Spot-check saved datasets

### Fine-Tuning
- **Held-Out Test Set:** Evaluate on unseen examples
- **Rollback Logic:** Discard changes that hurt performance
- **Bitmask Tracking:** Know which datasets helped
- **Final Evaluation:** Compare to teacher on test set

## Troubleshooting

### Out of Memory (OOM)

**During Data Generation:**
- Reduce `TEACHER_QUANTIZATION` to "4bit"
- Use smaller teacher model (Mixtral-8x7B)
- Close other GPU processes
- Generate fewer examples: `EXAMPLES_PER_DOC = 100`

**During Fine-Tuning:**
- Reduce `per_device_train_batch_size` to 1
- Increase `gradient_accumulation_steps` to 8
- Enable gradient checkpointing
- Use smaller student model (7B instead of 14B)

### Slow Generation

**Speed up Teacher:**
- Use Mixtral-8x7B instead of Llama-70B
- Reduce `max_tokens` in generation
- Use vLLM for faster inference (advanced)

**Speed up Training:**
- Reduce `EXAMPLES_PER_DOC` to 200
- Train on fewer documents initially
- Use Flash Attention 2 (if supported)

### Low Quality Datasets

**Improve Quality:**
- Use better teacher model (Llama-70B, Qwen-72B)
- Increase `SCORE_THRESHOLD` to 4.7
- Improve prompt templates in generation strategies
- Manually review and filter datasets

## Expected Results

### Dataset Quality
- **Pass Rate:** 40-60% of generated examples
- **Examples per Doc:** 200-400 high-quality pairs
- **Total Dataset:** 2,000-4,000 examples across 11 docs
- **Diversity:** Good coverage of Search + Tutor modes

### Student Model Performance
- **Size Reduction:** 10x smaller (70B → 7B)
- **Speed Improvement:** 10x faster inference
- **Quality Retention:** 85-95% of teacher performance
- **Specialization:** Excellent at RAG tasks

### Resource Usage
- **Total Time:** 12-18 hours (both stages)
- **Storage:** ~200GB (models + datasets)
- **Cost:** $0 (no API fees)

## Next Steps

After completing distillation:

1. **Evaluate** your student model thoroughly
2. **Deploy** using vLLM or TGI for production
3. **Iterate** by generating more data from weak areas
4. **Monitor** performance and retrain as needed

## Additional Resources

- **Hugging Face PEFT:** https://huggingface.co/docs/peft
- **QLoRA Paper:** https://arxiv.org/abs/2305.14314
- **Knowledge Distillation:** https://arxiv.org/abs/1503.02531
- **RAG Best Practices:** `priority-rag.md`

---

**Ready to start?** Open `create_dataset.ipynb` and begin with Stage 1! 🚀
