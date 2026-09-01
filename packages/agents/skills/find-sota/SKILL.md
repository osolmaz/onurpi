---
name: find-sota
description: Find current state-of-the-art or recent AI models from live Hugging Face Hub data. Use when the user asks for the newest, latest, recent, best, top, SOTA, recommended, or most practical model, including a named family such as Qwen. Checks release age, task evidence, and Hub usage. Also checks licensing, runtime support, model size, and device fit before making a recommendation.
---

# Find SOTA

Search the live Hugging Face Hub before recommending a model. Model names and
leaderboards from memory are candidate ideas only.

Use the official `hf-cli` and `huggingface-best` skills for Hub and benchmark
work. Also use `huggingface`, `browse-x-posts`, and `practical-significance`
when they apply.

## Keep the user's request intact

Write down what the user means by "best" before searching. Separate these
questions when needed:

- What is the newest official model in a named family?
- What model leads a benchmark that matches the task?
- What model is used enough to have credible runtime support?
- What model is the best practical choice on the user's hardware?

A task-specific fine-tune does not replace a requested general model. If the
user asks for a recent Qwen model, put official recent Qwen releases first.
Show a specialized fine-tune as a separate option.

Ask one question only when the model family, task, local or hosted requirement,
or hardware limit would materially change the search.

## Establish the current date

Run `date -u +%Y-%m-%d` at the start. Every recommendation must show the exact
release date and age. Never call a model recent without a date.

Search these age ranges in order:

1. The last 90 days.
2. The last 180 days when the first range has no credible candidate.
3. The last 365 days when necessary.

These ranges label search coverage only. They do not measure quality. Describe a
model older than one year as an older or established model in a request for
recent models.
If an older model remains the best choice, state why no newer model replaces it.

## Search the live Hub

Start with the requested publisher or model family, then search by task. Use
multiple sort orders because a new model can have low download counts.

```sh
hf models ls --author OWNER --sort created_at --limit 100 \
  --expand createdAt,lastModified,downloads,downloadsAllTime,likes,trendingScore,safetensors,cardData,sha \
  --format json

hf models ls --search "MODEL FAMILY OR TASK" --sort created_at --limit 100 \
  --expand createdAt,lastModified,downloads,downloadsAllTime,likes,trendingScore,safetensors,cardData,sha \
  --format json

hf models ls --search "MODEL FAMILY OR TASK" --sort trending_score --limit 100 \
  --expand createdAt,lastModified,downloads,downloadsAllTime,likes,trendingScore,safetensors,cardData,sha \
  --format json
```

Apply the user's parameter limit with `--num-parameters` when useful. Search the
publisher's complete recent list even when one familiar model already appears.
Search spelling variants and architecture names when the family has dense or
MoE weights and editions for instruction, thinking, images, or video.

For each finalist, inspect the repository itself:

```sh
hf models info OWNER/MODEL --format json
hf models ls OWNER/MODEL -R --format json
curl -fsSL "https://huggingface.co/api/models/OWNER/MODEL"
```

Read the model card and the relevant paper or technical report. Record the exact
Hub revision. Check the publisher identity so that a community conversion is
not mistaken for an official release.

Use web search to find release announcements and current benchmark reports.
Check current runtime issues as a separate search. Search the recent xTap corpus when social release reports or
community findings can improve a latest-information search. Treat posts as
claims until a primary source supports them.

## Check real usage

Record the Hub values at the time of the search:

- downloads shown by the Hub
- likes and trending score
- Spaces or applications using the model
- derivative or child model count when available
- supported inference providers and local applications
- maintenance history and material issues from discussions

Label each value exactly as the Hub reports it. Do not invent a time window for
a download count. A new model naturally has less usage history, so compare
adoption only with models of a similar age. Popularity is evidence of adoption,
not evidence of task quality.

Read the usage example in the model card. Confirm that it accepts the required
input and output form. For video tasks, check frame sampling and audio support.
Check timestamp handling and context limits too. Confirm whether the model can
return one span or all spans. A broad video question-answer benchmark does not prove accurate
timestamp localization.

## Verify benchmark fit

Fetch the current official benchmark list as described by `huggingface-best`.
Also inspect current task leaderboards and evaluation datasets that may not have
the official Hub tag.

For each score, record:

- benchmark and split
- metric and its plain meaning
- model size and exact checkpoint
- frame count and resolution
- context and prompt settings
- any use of audio or subtitles
- whether the score is from the model authors or an independent evaluator
- evaluation date or revision

Do not compare scores with different settings as if they were one leaderboard.
Do not use a general benchmark when a direct task benchmark exists. Report
missing uncertainty, raw counts, or independent reproduction plainly.

## Check whether it will run

Inspect the user's machine when local use matters. Record architecture, GPU,
available memory, and relevant existing canonical runtimes.

For every finalist, distinguish:

- total parameters and active parameters for MoE models.
- checkpoint bytes and load dtype.
- visual encoder and projector size.
- context and KV cache overhead.
- image and video token overhead.
- official full-precision or quantized weights versus community conversions.
- required library and minimum version.
- standard Transformers support versus `trust_remote_code`.
- license, gated access, and commercial-use limits.

Fitting weights in memory does not prove useful speed. Check measured throughput
on comparable hardware when it exists. Otherwise say that speed is unknown and
propose a short local benchmark.

Do not download, install, build, or run a model during a recommendation-only
request. Follow `manage-runtimes`, `safe-inference-launch`, and the inference
runtime provenance policy before a later local launch.

## Choose with practical significance

Keep these outcomes separate:

- newest credible release
- benchmark leader for the exact task
- most used stable option
- recommended model for this user

Show absolute score differences. Treat a small or uncertain lead as a tie and
prefer the smaller, faster, simpler, safer model. Do not let a popularity rank,
benchmark `argmax`, or release date alone choose the recommendation.

If the user asked for a model family or a general model, preserve that choice in
the main recommendation. Explain what a task-specific alternative gains and
what general ability it gives up.

## Report the result

Lead with the practical answer. Include a compact table with:

| Model | Release date and age | Total / active parameters | Direct task evidence | Hub usage | License | Runtime and device fit |
|---|---|---|---|---|---|---|

Then state:

1. the model to try first and why
2. the newest credible alternative
3. the task specialist when it differs
4. the main evidence gap and the smallest useful local test

Link every model to its Hub repository and every decisive benchmark to its
primary source. State the date when Hub usage was checked. If no recent model
has credible task evidence, say so instead of presenting an older model as new.
