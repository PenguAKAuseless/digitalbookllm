# Fine-Tuning Plan

This project includes a local LoRA fine-tuning pipeline for document tutoring behavior.

## Goal

Train a compact adapter on instruction pairs derived from local text corpora so the model responds in a document-tutor style.

## Pipeline Location

`documentation/pipelines/finetune`

## Outputs

- Prepared JSONL dataset
- LoRA adapter weights
- Tokenizer artifacts for deployment with the selected base model

## Notes

- Data preparation currently uses deterministic templates for local reproducibility.
- You can replace template completions with teacher-model generated targets when a local teacher model is available.
