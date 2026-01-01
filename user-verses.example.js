// Copy this file to `user-verses.js` and paste your exact verse text.
//
// NOTE:
// - Keep the structure the same.
// - Split each passage into multiple `lines` (how you want it displayed).
// - For the Philippians block, the LAST line is when both characters switch to RUN.
//
// Export name MUST be `SCRIPT`.

export const SCRIPT = [
  {
    ref: "Psalm 23:5 (NIV)",
    lines: [
      "<paste line 1>",
      "<paste line 2>",
      "<paste line 3>",
      "<paste line 4>",
    ],
    mode: "walk",
  },
  {
    ref: "Philippians 3:13–14 (NIV)",
    lines: [
      "<paste line 1>",
      "<paste line 2>",
      "<paste line 3>",
      "<paste FINAL line (triggers RUN)>",
    ],
    mode: "walk_then_run_on_last_line",
  },
];
