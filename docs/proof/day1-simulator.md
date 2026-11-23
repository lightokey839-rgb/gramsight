# Day 1 simulator proof (23 Nov 2026)

Setup: Node 24.22.1, `@evenrealities/evenhub-cli` 0.2.0, `@evenrealities/evenhub-simulator` 0.9.5 (global), template SDK `@evenrealities/even_hub_sdk` 0.0.10, Vite 5.4.21. Simulator launched with `evenhub-simulator http://localhost:5173 --automation-port 9898`; screenshots and input through its HTTP control plane.

| File | What it shows |
|---|---|
| `day1-01-template-boot.png` | Unmodified template: "Hello from G2!" (960 lit pixels) |
| `day1-02-changed-line.png` | After the one-line change: "SafeGlance: heads up, no phone." (1,348 lit pixels) |
| `day1-03-after-two-taps.png` | After two `POST /api/input {"action":"click"}`: "Taps: 2" (794 lit pixels) |
| `day1-console.json` | The app's console: `Page created: success`, then `[safeglance] input: click #1 via sysEvent` and `#2` |

Findings:

- Taps arrive as `sysEvent` with `eventType` omitted (CLICK_EVENT = 0 is dropped by protobuf) and `eventSource: 1` = `TOUCH_EVENT_FROM_GLASSES_R`. The SDK has a separate `TOUCH_EVENT_FROM_RING = 2`, so ring and temple taps can be told apart on hardware. The simulator's HTTP API only sends source 1, so the ring source needs real hardware to confirm.
- The first simulator launch drew nothing (0 lit pixels, empty console): it loaded before Vite was ready. Relaunching fixed it. Start the dev server first and wait for "ready".
- Manual input from the simulator window also arrived (console ids 15 and 19): one tap (`click #3`, source 1), then a double-tap (`eventType: 3`), which the template answers with `shutDownPageContainer(1)`, so the page closed and later button screenshots were blank. Exit-on-double-tap works.
- Screenshots are RGBA; transparent background, lit text is green with alpha > 0. Count lit pixels by alpha, not RGB.
