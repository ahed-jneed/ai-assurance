import { z } from "zod";
import { bucket, db } from "@/lib/bindings";
import { short } from "@/lib/commands/fields";
import { checkOrigin, readJson, responseError } from "@/lib/http";
import { currentUser } from "@/lib/identity";
import { now } from "@/lib/ids";
import {
  abandonedAfterDays,
  deletePractice,
  listPractices,
  operatorEvents,
  requireOperator,
} from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * The operator console's data (lib/operator.ts): the practices, the abandoned
 * ones only unless `?all=1`, and the operator audit trail. Platform operators
 * only; a practice membership grants nothing here.
 */
export async function GET(request: Request) {
  try {
    const operator = requireOperator(currentUser());
    const all = new URL(request.url).searchParams.get("all") === "1";
    return Response.json(
      {
        operator: { email: operator.email, name: operator.displayName },
        abandonedAfterDays,
        practices: await listPractices(db(), now(), { all }),
        events: await operatorEvents(db()),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}

const command = z
  .object({
    op: z.literal("deletePractice"),
    data: z
      .object({
        tenantId: short,
        confirmName: z.string().max(300),
        reason: z
          .string()
          .trim()
          .min(10, "State why the practice is deleted (10 characters or more)")
          .max(1000),
      })
      .strict(),
  })
  .strict();

/** Deletes an abandoned practice; see deletePractice in lib/operator.ts. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const operator = requireOperator(currentUser());
    const payload = command.parse(await readJson(request, 4096));
    return Response.json({
      details: await deletePractice(
        db(),
        bucket(),
        operator,
        payload.data,
        now(),
      ),
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    return responseError(error);
  }
}
