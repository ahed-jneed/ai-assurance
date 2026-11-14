/**
 * The rows that take focus when one leaves a list (#227), best first: the
 * rows after it in view order, then the rows before it, nearest first.
 */
export function focusAfterRemoval(order: readonly string[], removed: string) {
  const at = order.indexOf(removed);
  if (at < 0) return order.filter((id) => id !== removed);
  return [...order.slice(at + 1), ...order.slice(0, at).reverse()];
}
