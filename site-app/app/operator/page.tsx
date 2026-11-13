import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { isOperator } from "@/lib/operator";
import { OperatorConsole } from "./operator-console";

export const dynamic = "force-dynamic";

/**
 * The platform operator console (lib/operator.ts): abandoned practices and
 * their stored snapshots, deletion, and the operator audit trail. Everyone
 * else is told the page is for operators; the API refuses them as well.
 */
export default async function OperatorPage() {
  const user = await requireChatGPTUser("/operator");
  if (!isOperator(user.email))
    return (
      <main className="operator-console">
        <h1>Operator console</h1>
        <p>
          Only a platform operator may use this page. Operators are named in the
          PLATFORM_OPERATORS Worker variable.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full-page navigation back to the workspace */}
        <a href="/">Return to workspace</a>
      </main>
    );
  return <OperatorConsole />;
}
