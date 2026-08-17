### End-to-end exploration with llm-optimizer

> **Merged source:** This section retains benchmarking-tool guidance from the
> BentoML handbook snapshot at
> `ea07b2ccd9b35db810763fc76980b26be1d2b871` that was replaced by MAX-specific
> guidance in the later Modular revision.

BentoML's open-source
[llm-optimizer](https://www.bentoml.com/blog/announcing-llm-optimizer) was built
to explore serving configurations across frameworks such as vLLM and SGLang. It
can sweep native engine arguments and optimization choices, apply latency SLOs
to filter results, estimate candidate performance, and compare runs through the
[LLM Performance Explorer](https://www.bentoml.com/llm-perf/).

This is a separate option from framework-native scripts and MAX's benchmark
client. Verify its current engine compatibility and maintenance status before
adopting it for a new benchmark program.
