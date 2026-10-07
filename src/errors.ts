/**
 * Error model shared by every tool.
 *
 * Every failure reaches the client as `{error: {code, message, hint}}`. Errors raised inside After Effects
 * (host/core/util.jsx `fail`) and by the bridge already arrive in that shape; TypeScript-side logic throws
 * {@link AeToolError}, which the tool registry converts.
 */

export type ErrorCode =
  | "NOT_FOUND" // an id, file, property or job does not exist
  | "BAD_ARGS" // the arguments are invalid for the current project state
  | "AE_ERROR" // After Effects threw, or something unexpected failed
  | "BRIDGE_DOWN" // the CEP panel is not reachable (closed, stale token, AE not running)
  | "TIMEOUT" // no reply in time; the command may still finish in After Effects
  | "FORBIDDEN" // outside the allowed folders, or run_jsx disabled
  | "UNSUPPORTED" // this After Effects version lacks the feature
  | "EXISTS"; // refusing to overwrite an existing file

export interface ToolErrorBody {
  code: ErrorCode;
  message: string;
  hint?: string;
}

export class AeToolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "AeToolError";
  }

  toJSON(): ToolErrorBody {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

const CODES = new Set<string>(["NOT_FOUND", "BAD_ARGS", "AE_ERROR", "BRIDGE_DOWN", "TIMEOUT", "FORBIDDEN", "UNSUPPORTED", "EXISTS"]);

/** Normalise anything thrown into an error body. Unknown codes (e.g. Node's ENOENT) become AE_ERROR. */
export function toErrorBody(e: unknown): ToolErrorBody {
  if (e instanceof AeToolError) return e.toJSON();
  const err = e as { code?: unknown; message?: unknown; hint?: unknown } | undefined;
  return {
    code: typeof err?.code === "string" && CODES.has(err.code) ? (err.code as ErrorCode) : "AE_ERROR",
    message: typeof err?.message === "string" ? err.message : String(e),
    hint: typeof err?.hint === "string" ? err.hint : undefined,
  };
}
