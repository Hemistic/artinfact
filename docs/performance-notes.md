# Responsiveness changes in 0.13.15

Graph layout uses the existing force calculation in bounded chunks, yielding to input between chunks. A newer filter cancels older layout work. Whiteboard mode skips the hidden graph layout. Explicit layout restart uses the same incremental path. This improves responsiveness rather than claiming shorter total layout duration.

Card frames skip body measurement when neither content nor geometry changed. Static Milkdown rendering waits during pan, card drag, resize and zoom, then resumes after pointer release. Selection remains the switch into editing; no card dimensions or text were removed to obtain the improvement.

PDF AI reads accept an optional snapshot revision. An unchanged result returns only that revision. The revision covers AI content and jobs, not ordinary page position or manual annotation changes. Bibliography index reads also accept a known revision. Reader polling is frequent during live tasks and slower when idle, with immediate refresh on document/visibility changes and locally launched tasks. Existing domain writes and cancellation validation are unchanged.

Agent task open uses a lightweight task header before fetching scoped context. It returns exact reading tool arguments and a card-specific output guide. Standalone note edits avoid unrelated PDF reads; full-source research still requires the original text and actual images. Formula and evidence presentation fields retain their type; table recognition sends Markdown above the preserved source image. Candidates remain subject to user acceptance.

Manual evidence is recorded separately under `.context/releases/artinfact-0.13.15`. The layout observation compares identical final geometry and measures event-loop opportunities in an isolated Node process; it is not a native APP FPS benchmark. The MCP observation uses an isolated synthetic PDF and scratch workspace, preserving user research data. Native app checks must be reported separately from these observations.
