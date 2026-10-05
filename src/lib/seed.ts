import { OCTOBER_2_REPORTS, OCTOBER_3_REPORTS, OCTOBER_5_REPORTS } from "@/lib/fullbay-timesheet";
import type { DayReport } from "@/lib/types";

/** Friday and Saturday from the Details List downloads; Monday from the Fullbay timesheet scrape. */
export const SEED: DayReport[] = [...OCTOBER_2_REPORTS, ...OCTOBER_3_REPORTS, ...OCTOBER_5_REPORTS];
