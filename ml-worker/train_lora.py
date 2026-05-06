from __future__ import annotations

import argparse
from pathlib import Path

import yaml
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from trl import SFTTrainer


def format_record(record: dict[str, str]) -> str:
    return f"<|user|>\n{record['prompt']}\n<|assistant|>\n{record['completion']}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local LoRA fine-tuning")
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    args = parser.parse_args()

    config = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    training_cfg = config["training"]
    lora_cfg = config["lora"]
    dataset_file = Path(config["dataset"]["output_file"])

    if not dataset_file.exists():
        raise FileNotFoundError(
            f"Dataset file not found: {dataset_file}. Run prepare_dataset.py first."
        )

    dataset = load_dataset("json", data_files=str(dataset_file), split="train")

    model_name = training_cfg["base_model"]
    tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        device_map="auto",
        torch_dtype="auto",
    )

    peft_config = LoraConfig(
        r=int(lora_cfg["r"]),
        lora_alpha=int(lora_cfg["alpha"]),
        lora_dropout=float(lora_cfg["dropout"]),
        target_modules=list(lora_cfg["target_modules"]),
        bias="none",
        task_type="CAUSAL_LM",
    )

    training_args = TrainingArguments(
        output_dir=training_cfg["output_dir"],
        learning_rate=float(training_cfg["learning_rate"]),
        num_train_epochs=int(training_cfg["num_train_epochs"]),
        per_device_train_batch_size=int(training_cfg["per_device_train_batch_size"]),
        gradient_accumulation_steps=int(training_cfg["gradient_accumulation_steps"]),
        logging_steps=int(training_cfg["logging_steps"]),
        save_steps=int(training_cfg["save_steps"]),
        fp16=False,
        bf16=True,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        args=training_args,
        train_dataset=dataset,
        peft_config=peft_config,
        max_seq_length=int(training_cfg["max_seq_length"]),
        formatting_func=format_record,
    )

    trainer.train()
    trainer.model.save_pretrained(training_cfg["output_dir"])
    tokenizer.save_pretrained(training_cfg["output_dir"])
    print(f"Saved LoRA adapter to {training_cfg['output_dir']}")


if __name__ == "__main__":
    main()
