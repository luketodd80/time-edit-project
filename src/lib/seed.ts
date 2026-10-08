import { OCTOBER_2_REPORTS, OCTOBER_3_REPORTS, OCTOBER_5_REPORTS, OCTOBER_6_REPORTS, OCTOBER_7_REPORTS } from "@/lib/fullbay-timesheet";
import type { DayReport } from "@/lib/types";

/** Friday, Saturday, Monday, Tuesday, and Wednesday from the Details List downloads. */
export const SEED: DayReport[] = [...OCTOBER_2_REPORTS, ...OCTOBER_3_REPORTS, ...OCTOBER_5_REPORTS, ...OCTOBER_6_REPORTS, ...OCTOBER_7_REPORTS];
