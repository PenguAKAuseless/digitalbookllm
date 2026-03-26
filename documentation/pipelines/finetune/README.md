# Local Fine-Tune Pipeline

## Files

- `requirements.txt`: Python dependencies
- `config.yaml`: Dataset and training settings
- `prepare_dataset.py`: Builds JSONL training data from `documentation/docs/*.txt`
- `train_lora.py`: Runs LoRA fine-tuning with TRL SFTTrainer

## Setup

```bash
cd documentation/pipelines/finetune
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Prepare Dataset

```bash
python prepare_dataset.py --source-dir ../../docs --output-file ./data/train.jsonl --min-chars 400 --max-chars 1800
```

## Train LoRA Adapter

```bash
python train_lora.py --config config.yaml
```

## Result

The adapter and tokenizer are written to the output directory defined in `config.yaml`.
