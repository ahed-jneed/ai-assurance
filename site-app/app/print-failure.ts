import { forbidden, notFound } from "next/navigation";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { ApiError } from "@/lib/http";
import { setResponseStatus } from "@/lib/response-status";
import { printRefusal } from "./print-refusal";

/**
 * Renders every function component of a print view's markup now, while the
 * page body runs (#234 item 8): the markup's child components (the
 * assurance report, the criteria pack line, an LL144 table) would otherwise
 * render after the page body returned, so a failure in one of them would
 * escape its catch block and reach the workspace error boundary with 200.
 * Resolved here, a failure anywhere in the print tree throws inside the try
 * block and is answered by answerPrintFailure with the fallback and a log
 * line. The print markup is plain synchronous components without hooks.
 */
export function resolvePrintTree(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(resolvePrintTree);
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function") {
    const rendered = resolvePrintTree(
      (element.type as (props: unknown) => ReactNode)(element.props),
    );
    // A list item keeps its key once its component is replaced.
    return element.key !== null && isValidElement(rendered)
      ? cloneElement(rendered, { key: element.key })
      : rendered;
  }
  return element.props.children === undefined
    ? element
    : cloneElement(element, {
        children: resolvePrintTree(element.props.children),
      });
}

/**
 * Answers a print view's failure (/report, /ll144-summary) with the status
 * its JSON API gives for the same request (#209, #216, #220):
 *
 * - 403, a refusal: the segment's forbidden.tsx renders with the refusal's
 *   own message. Throws.
 * - 404, a missing, withdrawn, unreleased or unpublished record: the
 *   segment's not-found.tsx renders. Throws.
 * - Any other ApiError keeps its status, for example 409 for an integrity
 *   mismatch or an unreadable record and 503 for a missing or unavailable
 *   object (lib/engagement-storage.ts); anything else is a render failure
 *   and answers 500. Both are logged and return, so the page renders its
 *   own "could not be loaded" fallback with the recorded status.
 *
 * Call it from the catch block of a page body that the page calls (not
 * renders as an element), so the status is set before anything streams.
 */
export function answerPrintFailure(error: unknown, view: string): void {
  if (error instanceof ApiError && error.status === 403) {
    printRefusal().message = error.message;
    forbidden();
  }
  if (error instanceof ApiError && error.status === 404) notFound();
  console.error(`The ${view} print view could not be rendered:`, error);
  setResponseStatus(error instanceof ApiError ? error.status : 500);
}
