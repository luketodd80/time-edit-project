import { OCTOBER_2_REPORTS, OCTOBER_3_REPORTS, OCTOBER_5_REPORTS } from "@/lib/fullbay-timesheet";
import type { DayReport } from "@/lib/types";

/** Friday from the Details List download; Saturday and Monday from the Fullbay timesheet scrapes. */
export const SEED: DayReport[] = [...OCTOBER_2_REPORTS, ...OCTOBER_3_REPORTS, ...OCTOBER_5_REPORTS];
