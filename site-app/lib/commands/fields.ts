import { z } from "zod";
/** Bounded text fields shared by the command payload schemas. */
export const text = z.string().trim().min(1).max(5000),
  short = z.string().trim().min(1).max(300);
