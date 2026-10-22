// Types shared across the planner (declarations only). Kernel contract types live in ../kernel/types.d.ts.
// A module's own result shapes are JSDoc @typedefs in that module (import('./select.js').Selection, ...).

/** A strict JSON schema for structured output: { name, schema }. */
export interface ReplySchema { name: string; schema: Record<string, unknown>; [k: string]: unknown }

export interface WriterRequest {
  system: string;
  user: string;
  schema?: ReplySchema;
  effort?: string;
  maxTokens?: number;
  onDelta?: (text: string) => void;
}
/** `text` is model output: parse it with writer.parseReply, which returns `unknown`. */
export interface WriterReply { text: string; ms: number; model: string; usage: unknown }
/** A generative model behind the pipeline (writer.js). */
export interface Writer {
  provider: string;
  model: string;
  complete(request: WriterRequest): Promise<WriterReply>;
}
export interface Writers { spec: Writer | null; code: Writer | null }
