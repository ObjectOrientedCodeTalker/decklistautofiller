// Runs a fill plan against the editor one card at a time and reports what happened.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  DAF.runFill = async function runFill(plan, { catalog, onProgress, signal } = {}) {
    const editor = DAF.editor;
    const before = editor.counts();
    const failed = [];
    let added = 0;
    let stopped = false;

    for (let i = 0; i < plan.rows.length; i++) {
      // Stop only between cards, so a stop never leaves a search or add half-done.
      if (signal && signal.aborted) {
        stopped = true;
        break;
      }
      const row = plan.rows[i];
      onProgress && onProgress({ index: i, total: plan.rows.length, row, added, failed });
      try {
        await editor.addCard(row, catalog);
        added += row.qty;
      } catch (error) {
        failed.push({
          row,
          reason: error instanceof DAF.FillStepError ? error.reason : "error",
          message: error instanceof DAF.FillStepError ? error.message : "Something went wrong adding this card.",
        });
      }
    }

    const after = editor.counts();
    const delta = {
      main: after.main - before.main,
      extra: after.extra - before.extra,
      side: after.side - before.side,
    };
    return { added, failed, stopped, before, after, delta, expected: plan.expected, missing: plan.missing };
  };
})(DAF);
