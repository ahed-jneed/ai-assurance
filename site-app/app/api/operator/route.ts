import { z } from "zod";
import { bucket, db } from "@/lib/bindings";
import { short } from "@/lib/commands/fields";
import { checkOrigin, readJson, responseError } from "@/lib/http";
import { currentUser } from "@/lib/identity";
import { now } from "@/lib/ids";
import {
  abandonedAfterDays,
  archivePractice,
  deletePractice,
  issuedWork,
  operatorEvents,
  practicePage,
  requireOperator,
} from "@/lib/operator";

export const dynamic = "force-dynamic";

/** A page cursor's last activity: an ISO timestamp, as listPractices sorts. */
const cursorActivity = z.string().max(40);

/**
 * The operator console's data (lib/operator.ts): one page of the practices,
 * longest inactive first (only those that may be deleted or archived and
 * those archived, unless `?all=1`; the next page with `?afterActivity=` and
 * `?afterId=` from `next`), and the operator audit trail; or, with `?tenantId=`, an archived practice's issued work for
 * answering verification requests. Platform operators only; a practice
 * membership grants nothing here.
 */
export async function GET(request: Request) {
  try {
    const operator = requireOperator(currentUser());
    const query = new URL(request.url).searchParams;
    const headers = { "Cache-Control": "private, no-store" };
    const tenantId = query.get("tenantId");
    if (tenantId !== null)
      return Response.json(
        { issued: await issuedWork(db(), bucket(), short.parse(tenantId)) },
        { headers },
      );
    const all = query.get("all") === "1",
      afterActivity = query.get("afterActivity"),
      afterId = query.get("afterId");
    const after =
      afterActivity !== null || afterId !== null
        ? {
            lastActivity: cursorActivity.parse(afterActivity),
            id: short.parse(afterId),
          }
        : undefined;
    const page = await practicePage(db(), now(), { all, after });
    return Response.json(
      {
        operator: { email: operator.email, name: operator.displayName },
        abandonedAfterDays,
        practices: page.practices,
        next: page.next,
        events: await operatorEvents(db()),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "Invalid practice or page" },
        { status: 400 },
      );
    return responseError(error);
  }
}

const data = z
  .object({
    tenantId: short,
    confirmName: z.string().max(300),
    reason: z
      .string()
      .trim()
      .min(10, "State why (10 characters or more)")
      .max(1000),
  })
  .strict();
const command = z.discriminatedUnion("op", [
  z.object({ op: z.literal("deletePractice"), data }).strict(),
  z.object({ op: z.literal("archivePractice"), data }).strict(),
]);

/**
 * Deletes an abandoned practice, or archives one that holds issued work; see
 * deletePractice and archivePractice in lib/operator.ts.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const operator = requireOperator(currentUser());
    const payload = command.parse(await readJson(request, 4096));
    return Response.json({
      details:
        payload.op === "archivePractice"
          ? await archivePractice(db(), operator, payload.data, now())
          : await deletePractice(db(), bucket(), operator, payload.data, now()),
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
