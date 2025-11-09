# Hugging Face Authentication Setup

## Why Do I Need This?

The Llama-3.1-70B-Instruct model is a **gated model** on Hugging Face. This means Meta requires you to:
1. Accept their license agreement
2. Authenticate to prove you have access

## Step-by-Step Setup

### 1️⃣ Request Model Access

1. Visit the model page: https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct
2. Click the **"Request Access"** button (you'll need a Hugging Face account)
3. Fill out the form and accept Meta's license agreement
4. Wait for approval (usually **instant**, sometimes takes a few hours)

### 2️⃣ Get Your Hugging Face Token

1. Go to your Hugging Face settings: https://huggingface.co/settings/tokens
2. Click **"Create new token"** (or use an existing one)
3. Give it a name (e.g., "Local Development")
4. Select token type: **"Read"** is sufficient (not "Write")
5. Click **"Generate token"**
6. **Copy the token** (it looks like `hf_xxxxxxxxxxxxxxxxxxxxx`)

### 3️⃣ Authenticate in the Notebook

Run the authentication cell in `create_dataset.ipynb`:

```python
from huggingface_hub import login
login()
```

When prompted, paste your token and press Enter.

### 4️⃣ Verify Authentication

After logging in, try loading the model again. You should see:
```
✓ Successfully authenticated with Hugging Face!
```

---

## Alternative: Use Environment Variable

For better security (especially if sharing notebooks), store your token in a `.env` file:

1. Create a `.env` file in your project directory:
   ```bash
   HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx
   ```

2. Load it in your notebook:
   ```python
   from dotenv import load_dotenv
   import os
   from huggingface_hub import login
   
   load_dotenv()
   token = os.getenv("HF_TOKEN")
   login(token=token)
   ```

3. **Add `.env` to `.gitignore`** to prevent committing your token!

---

## Alternative: Use Different Models (No Auth Required)

If you don't want to deal with gated models, you can use these **unrestricted alternatives**:

### Smaller Models (Faster, Less VRAM)
- **`mistralai/Mistral-7B-Instruct-v0.3`** (7B) - 16GB VRAM
- **`microsoft/Phi-3-medium-4k-instruct`** (14B) - 28GB VRAM
- **`google/gemma-2-9b-it`** (9B) - 18GB VRAM

### Larger Models (Better Quality)
- **`tiiuae/falcon-40b-instruct`** (40B) - 80GB VRAM (needs multi-GPU)
- **`mistralai/Mixtral-8x7B-Instruct-v0.1`** (47B) - 90GB VRAM (needs multi-GPU)

### To Use an Alternative Model:

In `create_dataset.ipynb`, change the configuration cell:

```python
# --- Teacher Model (Local) ---
# Original (requires auth):
# TEACHER_MODEL_NAME = "meta-llama/Llama-3.1-70B-Instruct"

# Alternative (no auth required):
TEACHER_MODEL_NAME = "mistralai/Mistral-7B-Instruct-v0.3"
```

---

## Troubleshooting

### Error: "401 Client Error: Unauthorized"
- **Solution:** You haven't authenticated yet. Run the login cell.

### Error: "Access to model is restricted"
- **Solution:** You haven't requested access. Visit the model page and click "Request Access".

### Error: "403 Forbidden"
- **Solution:** Your token doesn't have the right permissions. Create a new token with at least "Read" access.

### Token Not Saving
- **Solution:** Use `login(token="your_token", add_to_git_credential=True)` to save it permanently.

---

## Security Best Practices

✅ **DO:**
- Store tokens in `.env` files (and add to `.gitignore`)
- Use "Read" tokens for inference (not "Write")
- Revoke old tokens you're not using

❌ **DON'T:**
- Commit tokens to Git repositories
- Share tokens publicly
- Use "Write" tokens unless necessary

---

## Quick Check: Am I Authenticated?

Run this in a notebook cell:

```python
from huggingface_hub import HfFolder
token = HfFolder.get_token()
if token:
    print(f"✓ Authenticated! Token: {token[:10]}...")
else:
    print("✗ Not authenticated. Run login() first.")
```

---

**Next Steps:** After authentication, return to `create_dataset.ipynb` and run the teacher model loading cell.
