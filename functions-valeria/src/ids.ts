/**
 * ids.ts — geração de identificadores opacos (sprint P0.2). Extraído de
 * valeria.ts para ser compartilhado por action_executor.ts sem criar
 * dependência circular.
 */
import { randomUUID } from "crypto";

export function uid(prefix = "v"): string {
  return `${prefix}_${randomUUID()}`;
}
