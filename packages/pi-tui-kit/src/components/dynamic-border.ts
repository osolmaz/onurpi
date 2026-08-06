import type { Component } from "@earendil-works/pi-tui";

/** Width-aware border that uses only Pi TUI's public component contract. */
export class DynamicBorder implements Component {
	constructor(private readonly color: (text: string) => string = (text) => text) {}

	invalidate() {}

	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}
