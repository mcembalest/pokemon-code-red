"""Feasibility experiment: can a tiny model "level up" at writing move code by practicing?

Runs on Modal (GPU). Rewards come from the real game sandbox (rl/env, pi-codemode in Node):
miss 0 / hit 1 / crit 1.3 for each code block a model writes for a starter-battle move.

    modal run rl/train.py --config rl/run.json

Writes rl/results/<run>.json (baseline + learning curve + sample code). Notes: notes/rl.md.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent
app = modal.App("code-red-rl")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates", "gnupg")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs")
    .pip_install("torch==2.14.1", "transformers==5.19.0", "trl==1.14.1", "peft==0.21.2", "accelerate==1.15.0", "datasets==5.1.0")
    .add_local_dir(ROOT / "env", "/env", copy=True, ignore=["node_modules"])
    .run_commands("cd /env && npm ci --omit=dev")
)
hf_cache = modal.Volume.from_name("code-red-hf-cache", create_if_missing=True)
MOVES = ["SCRATCH", "TACKLE", "GROWL", "TAIL WHIP"]


class Evaluator:
    """Persistent `node evaluate.mjs`; scores batches of completions in the game sandbox."""

    def __init__(self):
        self.proc = subprocess.Popen(["node", "/env/evaluate.mjs"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.next_id = 0

    def score(self, items: list[dict]) -> list[dict]:
        ids = []
        for it in items:
            self.next_id += 1
            ids.append(self.next_id)
            self.proc.stdin.write(json.dumps({"id": self.next_id, **it}) + "\n")
        self.proc.stdin.flush()
        out = {}
        while len(out) < len(ids):
            r = json.loads(self.proc.stdout.readline())
            out[r["id"]] = r
        return [out[i] for i in ids]


def prompt_messages(move: str, seed: int, level: int = 5) -> list[dict]:
    # Same prompt as the game (rl/env/evaluate.mjs promptFor), produced by Node so they never drift.
    p = json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e",
         f"import {{ promptFor }} from '/env/evaluate.mjs'; import {{ makeFoe }} from '/env/contracts.mjs';"
         f"console.log(JSON.stringify(promptFor({json.dumps(move)}, {{ level: {level}, foe: makeFoe({seed}) }})))"], text=True))
    return [{"role": "system", "content": p["system"]}, {"role": "user", "content": p["user"]}]


@app.function(image=image, gpu="L4", timeout=3 * 3600, volumes={"/root/.cache/huggingface": hf_cache})
def run(cfg: dict) -> dict:
    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback
    from trl import GRPOConfig, GRPOTrainer

    t_start = time.time()
    model_id, level = cfg["model"], cfg.get("level", 5)
    ev = Evaluator()
    tok = AutoTokenizer.from_pretrained(model_id)
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(model_id, dtype=torch.bfloat16).to("cuda")

    prompt_cache: dict[tuple, list] = {}

    def messages(move, seed):
        key = (move, seed)
        if key not in prompt_cache:
            prompt_cache[key] = prompt_messages(move, seed, level)
        return prompt_cache[key]

    @torch.no_grad()
    def evaluate(m, n_per_move: int, tag: str, samples: int = 3) -> dict:
        was_training = m.training
        m.eval()
        rows = []
        for move in MOVES:
            seeds = [100_000 + i for i in range(n_per_move)]
            texts = [tok.apply_chat_template(messages(move, s), tokenize=False, add_generation_prompt=True) for s in seeds]
            outs = []
            for i in range(0, len(texts), 32):
                enc = tok(texts[i:i + 32], return_tensors="pt", padding=True).to("cuda")
                gen = m.generate(**enc, max_new_tokens=cfg.get("max_completion_length", 256), do_sample=True, temperature=0.8, top_p=0.95, pad_token_id=tok.pad_token_id)
                outs += tok.batch_decode(gen[:, enc["input_ids"].shape[1]:], skip_special_tokens=True)
            scored = ev.score([{"move": move, "seed": s, "level": level, "completion": c} for s, c in zip(seeds, outs)])
            rows += [{"move": move, "completion": c, **r} for c, r in zip(outs, scored)]
        if was_training:
            m.train()
        rates = {}
        for move in MOVES + ["ALL"]:
            sel = [r for r in rows if move == "ALL" or r["move"] == move]
            rates[move] = {k: round(sum(r["outcome"] == k for r in sel) / len(sel), 3) for k in ("miss", "hit", "crit")}
        reasons: dict[str, int] = {}
        for r in rows:
            if r["outcome"] == "miss":
                key = (r.get("reason") or "?").split(":")[0][:40]
                reasons[key] = reasons.get(key, 0) + 1
        examples = {}
        for move in MOVES:
            mine = [r for r in rows if r["move"] == move]
            examples[move] = [{"outcome": r["outcome"], "reason": r.get("reason"), "completion": r["completion"][:800]} for r in mine[:samples]]
        print(f"[{tag}] {json.dumps(rates['ALL'])} {json.dumps(reasons)}", flush=True)
        return {"tag": tag, "rates": rates, "miss_reasons": reasons, "examples": examples}

    result = {"config": cfg, "baseline": evaluate(model, cfg["eval_per_move"], "baseline")}

    if cfg.get("train_steps", 0) > 0:
        train_seeds = range(cfg["train_prompts_per_move"])
        ds = Dataset.from_list([{"prompt": messages(m, s), "move": m, "seed": s, "level": level} for m in MOVES for s in train_seeds])

        def code_reward(prompts, completions, move, seed, level, **_):
            texts = [c[-1]["content"] if isinstance(c, list) else c for c in completions]
            return [r["reward"] for r in ev.score([{"move": mv, "seed": sd, "level": lv, "completion": t} for mv, sd, lv, t in zip(move, seed, level, texts)])]

        curve = []

        class Curve(TrainerCallback):
            def on_step_end(self, args, state, control, **kw):
                if state.global_step % cfg["eval_every"] == 0 or state.global_step == cfg["train_steps"]:
                    curve.append({"step": state.global_step, **evaluate(kw["model"], cfg["eval_per_move_curve"], f"step {state.global_step}", samples=1)})

        args = GRPOConfig(
            output_dir="/tmp/out", max_steps=cfg["train_steps"], learning_rate=cfg.get("lr", 5e-5),
            per_device_train_batch_size=cfg.get("batch", 16), gradient_accumulation_steps=1,
            num_generations=cfg.get("num_generations", 8), max_completion_length=cfg.get("max_completion_length", 256),
            temperature=cfg.get("temperature", 0.9), beta=cfg.get("beta", 0.0), bf16=True,
            logging_steps=5, save_strategy="no", report_to="none", gradient_checkpointing=True,
        )
        peft_config = LoraConfig(r=cfg.get("lora_r", 16), lora_alpha=cfg.get("lora_alpha", 32), target_modules="all-linear", task_type="CAUSAL_LM")
        trainer = GRPOTrainer(model=model, reward_funcs=code_reward, args=args, train_dataset=ds, processing_class=tok, peft_config=peft_config, callbacks=[Curve()])
        t0 = time.time()
        trainer.train()
        result["train_seconds"] = round(time.time() - t0)
        result["curve"] = curve
        result["train_log"] = [h for h in trainer.state.log_history if "reward" in h or "loss" in h]
        result["final"] = evaluate(trainer.model, cfg["eval_per_move"], "final")
    result["total_seconds"] = round(time.time() - t_start)
    return result


@app.local_entrypoint()
def main(config: str = "rl/run.json"):
    runs = json.loads(Path(config).read_text())
    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    for cfg in runs["runs"]:
        name = cfg["name"]
        print(f"=== {name}: {cfg['model']}", flush=True)
        res = run.remote(cfg)
        (out_dir / f"{name}.json").write_text(json.dumps(res, indent=2))
        b, f = res["baseline"]["rates"]["ALL"], res.get("final", {}).get("rates", {}).get("ALL")
        print(f"RESULT {name}: baseline {b} final {f} train_s {res.get('train_seconds')} total_s {res['total_seconds']}", flush=True)
