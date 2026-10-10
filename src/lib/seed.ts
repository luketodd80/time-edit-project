import { OCTOBER_2_REPORTS, OCTOBER_3_REPORTS, OCTOBER_5_REPORTS, OCTOBER_6_REPORTS, OCTOBER_7_REPORTS, OCTOBER_8_REPORTS, OCTOBER_9_REPORTS } from "@/lib/fullbay-timesheet";
import type { DayReport } from "@/lib/types";

/** October 2 through October 9 from the Details List downloads. */
export const SEED: DayReport[] = [...OCTOBER_2_REPORTS, ...OCTOBER_3_REPORTS, ...OCTOBER_5_REPORTS, ...OCTOBER_6_REPORTS, ...OCTOBER_7_REPORTS, ...OCTOBER_8_REPORTS, ...OCTOBER_9_REPORTS];
