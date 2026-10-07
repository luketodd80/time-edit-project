import { OCTOBER_2_REPORTS, OCTOBER_3_REPORTS, OCTOBER_5_REPORTS, OCTOBER_6_REPORTS } from "@/lib/fullbay-timesheet";
import type { DayReport } from "@/lib/types";

/** Friday, Saturday, Monday, and Tuesday from the Details List downloads. */
export const SEED: DayReport[] = [...OCTOBER_2_REPORTS, ...OCTOBER_3_REPORTS, ...OCTOBER_5_REPORTS, ...OCTOBER_6_REPORTS];
