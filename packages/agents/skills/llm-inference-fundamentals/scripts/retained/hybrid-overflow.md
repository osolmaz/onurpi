## Hybrid overflow between on-prem and cloud

> **Merged source:** This section retains deployment guidance from the BentoML
> handbook snapshot at `ea07b2ccd9b35db810763fc76980b26be1d2b871` that is not
> present in the later Modular revision.

An on-prem cluster can serve secure, predictable baseline demand while cloud
GPUs absorb traffic that exceeds local capacity. This avoids buying enough
hardware for every possible peak when GPU procurement is slow and burst demand
is uncertain.

The pattern balances local control with availability and cost. Sensitive or
regulated work stays in the data center, cloud capacity handles spikes, and the
operator pays for overflow only when it is needed. It is most useful when steady
demand justifies owned or reserved hardware but peak demand does not.

For more context, see BentoML's discussion of the
[GPU CAP theorem](https://www.bentoml.com/blog/how-to-beat-the-gpu-cap-theorem-in-ai-inference).
