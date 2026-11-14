import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain/types";
import { ApiError } from "../../http";
import { id } from "../../ids";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementHandler, ManagementModule } from "./batch";
/** Creating a client and editing its name and sector share one handler. */
const saveClient: ManagementHandler = {
  roles,
  async handle({ commandId, timestamp, guard, statements }, data, ctx, op) {
    const a = z
      .object({ name: short, sector: short, clientId: short.optional() })
      .parse(data);
    const clientId = op === "createClient" ? id("CL") : a.clientId;
    if (
      !clientId ||
      (op === "updateClient" &&
        !(await db()
          .prepare("SELECT id FROM clients WHERE tenant_id=? AND id=?")
          .bind(ctx.tenantId, clientId)
          .first()))
    )
      throw new ApiError(404, "Client not found");
    statements.push(
      op === "createClient"
        ? db()
            .prepare(
              "INSERT INTO clients(tenant_id,id,name,sector,created_at) SELECT ?,?,?,?,? WHERE " +
                guard,
            )
            .bind(
              ctx.tenantId,
              clientId,
              a.name,
              a.sector,
              timestamp,
              ctx.tenantId,
              commandId,
            )
        : db()
            .prepare(
              "UPDATE clients SET name=?,sector=? WHERE tenant_id=? AND id=? AND " +
                guard,
            )
            .bind(
              a.name,
              a.sector,
              ctx.tenantId,
              clientId,
              ctx.tenantId,
              commandId,
            ),
    );
    return { clientId, name: a.name, sector: a.sector };
  },
};
/** The practice's clients. */
export const clients: ManagementModule = defineCommands({
  createClient: saveClient,
  updateClient: saveClient,
});
