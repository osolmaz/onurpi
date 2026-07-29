/**
 * A capped buffer that preserves a stable prefix ("head") and suffix ("tail"),
 * dropping the middle once it exceeds the configured maximum. The buffer is
 * symmetric: 50% of the capacity is allocated to the head and 50% to the tail.
 *
 * Direct port of codex's HeadTailBuffer (codex-rs/core/src/unified_exec/head_tail_buffer.rs).
 */
export class HeadTailBuffer {
	readonly maxBytes: number;
	readonly headBudget: number;
	readonly tailBudget: number;
	private head: Uint8Array[] = [];
	private tail: Uint8Array[] = [];
	private headBytesInternal = 0;
	private tailBytesInternal = 0;
	private omittedBytesInternal = 0;

	/**
	 * Create a new buffer that retains at most `maxBytes` of output.
	 *
	 * The retained output is split across a prefix ("head") and suffix ("tail")
	 * budget, dropping bytes from the middle once the limit is exceeded.
	 */
	constructor(maxBytes: number) {
		if (!Number.isFinite(maxBytes) || maxBytes < 0) {
			throw new Error(`maxBytes must be a non-negative finite number (got ${maxBytes})`);
		}
		this.maxBytes = Math.floor(maxBytes);
		this.headBudget = Math.floor(this.maxBytes / 2);
		this.tailBudget = Math.max(0, this.maxBytes - this.headBudget);
	}

	/** Total bytes currently retained by the buffer (head + tail). */
	get retainedBytes(): number {
		return this.headBytesInternal + this.tailBytesInternal;
	}

	/** Total bytes that were dropped from the middle due to the size cap. */
	get omittedBytes(): number {
		return this.omittedBytesInternal;
	}

	/**
	 * Append a chunk of bytes to the buffer.
	 *
	 * Bytes are first added to the head until the head budget is full; any
	 * remaining bytes are added to the tail, with older tail bytes being
	 * dropped to preserve the tail budget.
	 */
	pushChunk(chunk: Uint8Array): void {
		if (this.maxBytes === 0) {
			this.omittedBytesInternal += chunk.length;
			return;
		}
		if (chunk.length === 0) return;

		// Always store an owned copy so later caller mutations to the input
		// buffer cannot poison our retained state (matches codex's `Vec<u8>`
		// by-value ownership semantics).
		const owned = copyOf(chunk);

		// Fill the head budget first, then keep a capped tail.
		if (this.headBytesInternal < this.headBudget) {
			const remainingHead = this.headBudget - this.headBytesInternal;
			if (owned.length <= remainingHead) {
				this.headBytesInternal += owned.length;
				this.head.push(owned);
				return;
			}
			// Split the chunk: part goes to head, remainder goes to tail.
			const headPart = owned.subarray(0, remainingHead);
			const tailPart = owned.subarray(remainingHead);
			if (headPart.length > 0) {
				this.headBytesInternal += headPart.length;
				this.head.push(copyOf(headPart));
			}
			this.pushToTail(copyOf(tailPart));
			return;
		}

		this.pushToTail(owned);
	}

	/**
	 * Snapshot the retained output as a list of chunks (head then tail).
	 * Omitted bytes are not represented. Non-destructive.
	 */
	snapshotChunks(): Uint8Array[] {
		return [...this.head, ...this.tail];
	}

	/** Return the retained output as a single Buffer (head then tail). */
	toBytes(): Uint8Array {
		const out = new Uint8Array(this.retainedBytes);
		let offset = 0;
		for (const c of this.head) {
			out.set(c, offset);
			offset += c.length;
		}
		for (const c of this.tail) {
			out.set(c, offset);
			offset += c.length;
		}
		return out;
	}

	/**
	 * Drain all retained chunks from the buffer and reset its state.
	 *
	 * The drained chunks are returned in head-then-tail order. Omitted bytes
	 * are discarded along with the retained content.
	 */
	drainChunks(): Uint8Array[] {
		const out = [...this.head, ...this.tail];
		this.head = [];
		this.tail = [];
		this.headBytesInternal = 0;
		this.tailBytesInternal = 0;
		this.omittedBytesInternal = 0;
		return out;
	}

	private pushToTail(chunk: Uint8Array): void {
		if (this.tailBudget === 0) {
			this.omittedBytesInternal += chunk.length;
			return;
		}

		if (chunk.length >= this.tailBudget) {
			// This single chunk is larger than the whole tail budget. Keep only the last
			// tailBudget bytes and drop everything else.
			const start = chunk.length - this.tailBudget;
			const kept = copyOf(chunk.subarray(start));
			const dropped = chunk.length - kept.length;
			this.omittedBytesInternal += this.tailBytesInternal + dropped;
			this.tail = [];
			this.tailBytesInternal = kept.length;
			this.tail.push(kept);
			return;
		}

		this.tailBytesInternal += chunk.length;
		this.tail.push(chunk);
		this.trimTailToBudget();
	}

	private trimTailToBudget(): void {
		let excess = this.tailBytesInternal - this.tailBudget;
		while (excess > 0 && this.tail.length > 0) {
			const front = this.tail[0]!;
			if (excess >= front.length) {
				excess -= front.length;
				this.tailBytesInternal -= front.length;
				this.omittedBytesInternal += front.length;
				this.tail.shift();
			} else {
				// Drop `excess` bytes from the start of the front chunk.
				this.tail[0] = copyOf(front.subarray(excess));
				this.tailBytesInternal -= excess;
				this.omittedBytesInternal += excess;
				break;
			}
		}
	}
}

function copyOf(view: Uint8Array): Uint8Array {
	// Produce an owned copy so later mutations of the source buffer cannot
	// poison our retained state.
	const out = new Uint8Array(view.length);
	out.set(view);
	return out;
}
