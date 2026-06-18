import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

// A trivial graph that adds 1 to a running total each invocation. No LLM —
// it exercises the checkpointer's persistence contract deterministically:
// state accumulated under a thread_id must survive across separate
// invocations and across a fresh checkpointer instance.
export const CounterState = Annotation.Root({
  total: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
});

export function buildCounterGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(CounterState)
    .addNode("addOne", () => ({ total: 1 }))
    .addEdge(START, "addOne")
    .addEdge("addOne", END)
    .compile({ checkpointer });
}
