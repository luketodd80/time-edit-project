import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { historyDaysWithData, parseUtilizationHistory, serializeUtilizationHistory, type UtilShopDay } from "@/lib/utilization-history";
import { COMMITTED_HISTORY_PATH, updateUtilizationHistory } from "./update-utilization-history";

describe("history update", () => {
  it("keeps a previously committed day the loaded seed no longer has", () => {
    const directory = mkdtempSync(join(tmpdir(), "history-update-"));
    const historyPath = join(directory, "utilization-history.json");
    try {
      const committed = parseUtilizationHistory(JSON.parse(readFileSync(COMMITTED_HISTORY_PATH, "utf8")));
      const older: UtilShopDay = {
        day: "2026-09-15",
        shopId: "dayton",
        queueCovered: true,
        techs: [{ id: "tech-1", name: "Tech One", clockedHours: 10, soHours: 9, addedMinutes: 40 }],
      };
      writeFileSync(historyPath, serializeUtilizationHistory([...committed, older]));
      const before = historyDaysWithData(parseUtilizationHistory(JSON.parse(readFileSync(historyPath, "utf8"))));
      assert.ok(before.includes("2026-09-15"));

      updateUtilizationHistory({ historyPath });

      const after = parseUtilizationHistory(JSON.parse(readFileSync(historyPath, "utf8")));
      const afterDays = historyDaysWithData(after);
      const dropped = before.filter((day) => !afterDays.includes(day));
      assert.deepEqual(dropped, [], `history update dropped ${dropped.join(", ")}`);
      assert.equal(after.find((row) => row.day === "2026-09-15" && row.shopId === "dayton")?.techs[0]?.addedMinutes, 40);
      assert.ok(afterDays.includes("2026-10-02"));
      assert.ok(afterDays.includes("2026-10-08"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
