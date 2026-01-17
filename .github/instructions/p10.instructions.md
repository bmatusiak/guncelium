# Strict Engineering & JPL Power of 10 Policy

## 1. The "No-Fallback" Mandate
- **No Graceful Degradation:** Never implement "Plan B" logic. If the primary method fails, the code must throw an explicit exception and halt.
- **Fail-Fast:** Ensure the system crashes immediately when a requirement is not met. Never return `null`, `false`, or empty placeholders to "stay silent."
- **No Swallowing Errors:** No empty `catch` blocks. Error handling is for logging or cleanup only, not for bypassing logic.

## 2. JPL "Power of 10" Rules (Safety-Critical)
1. **Simple Control Flow:** No `goto`, `setjmp`, `longjmp`, or direct/indirect recursion.
2. **Fixed Loop Bounds:** All loops must have a fixed, verifiable upper bound. No infinite or unpredictable loops.
3. **No Dynamic Allocation:** Avoid heap allocation (malloc/new) after initialization. Use stack or static allocation where possible.
4. **Small Functions:** No function should exceed 60 lines (one printed page).
5. **Assertion Density:** Average at least 2 assertions per function to check for "impossible" conditions.
6. **Small Scope:** Declare variables at the smallest possible level of scope.
7. **Check Everything:** Check the return value of ALL non-void functions and validate ALL parameters.
8. **Minimal Preprocessor:** Limit preprocessor use to header inclusions and simple macros.
9. **Restrict Pointers:** Use no more than one level of pointer dereferencing. No function pointers.
10. **Zero Warnings:** Code must compile with all warnings enabled and zero warnings produced.

## 3. Logic Replacement Only
- **Strict Rewriting:** If code is identified as "bad" or "insecure," REWRITE the core logic. Never add a fallback wrapper around bad code.
- **Deterministic Paths:** Every function must have one clear, high-integrity execution path.

## 4. Interaction Protocol
- If a request violates these rules, state "SAFETY_VIOLATION" and explain why.
- Do not provide "best effort" solutions that compromise these principles.

# AI Coding Agent Instructions (Power-of-10 Inspired)

This repo benefits from changes that are easy to review, easy to test, and hard to misinterpret.
These instructions adapt the “Power of 10” ideas into concrete rules for an AI coding agent working in a real codebase.

## Primary objective

Make minimal, correct, verifiable changes.
Prefer clarity and determinism over cleverness.

## Operating principles

- Be surgical: change the smallest surface area that solves the problem.
- Be explicit: if behavior changes, ensure it’s covered by tests/logging/docs.
- Be deterministic: avoid unbounded work, hidden side effects, and implicit global state.
- Be tool-friendly: write code that static analysis, linters, and reviewers can reason about.

## The 10 rules (agent-adapted)

### 1) Keep control flow simple (no surprise jumps)

- Avoid recursion (direct or indirect). Prefer iterative logic.
- Avoid complex exception-driven control flow; use early returns with clear error values.
- Avoid “spooky action”: no hidden work in getters, constructors, or implicit hooks.

### 2) Bound all loops and retries

- Every retry/loop must have a hard cap (attempt count, timeout, max bytes/messages).
- Network/IO loops must include: timeout + maximum retries + backoff strategy.
- If a loop is intentionally infinite (e.g., event loop), it must be obviously so and isolated.

### 3) Avoid dynamic allocation / resource growth in hot paths

Generalizing “no malloc after init” to modern stacks:

- Don’t allocate unbounded memory in long-lived loops (queues, buffers, caches).
- Prefer bounded data structures and apply limits (max entries, max size, max age).
- Close/release resources deterministically (files, sockets, streams, listeners, timers).

### 4) Keep functions small and single-purpose

- Target: ≤ 60 lines per function; split earlier if the function mixes concerns.
- Prefer helper functions with descriptive names over deep nesting.
- Keep modules cohesive: avoid “god files” that mix unrelated responsibilities.

### 5) Use assertions and explicit error handling

- Use assertions for “should never happen” invariants (dev/debug builds).
- Use runtime checks for user input, network data, file contents, and external APIs.
- On failure: return a typed error / rejected promise / error code consistently; do not silently continue.
- Assertions must be side-effect free.

### 6) Minimize scope and mutability

- Declare variables as close as possible to first use.
- Prefer immutable bindings (`const`, immutable structs) unless mutation is required.
- Avoid shared mutable global state; when unavoidable, document ownership and lifecycle.

### 7) Validate inputs and check outputs

- Validate all parameters at module boundaries (public functions, RN bridges, FFI, API handlers).
- Check every non-void return where failure matters; do not ignore promises.
- If a return value is intentionally ignored, do it explicitly and document why.

### 8) Limit preprocessor / meta-programming

- Avoid macro tricks, code generation surprises, and heavy conditional compilation.
- Prefer straightforward language features over metaprogramming when readability suffers.
- If platform conditionals are required, keep them localized and well-tested.

### 9) Keep indirection shallow

Generalizing “pointer restrictions”:

- Avoid deep pointer/ref chains in native code; keep ownership clear.
- Avoid excessive abstraction layers (factory-of-factory, dynamic dispatch everywhere).
- Prefer direct calls over reflection/dynamic `eval`-like behavior.

### 10) Treat warnings and static analysis as errors

- Build/Typecheck/Lint with the strictest practical settings.
- Do not introduce new warnings.
- If a tool is confused, rewrite the code for clarity rather than suppressing indiscriminately.

## Change protocol (what the agent should do every time)

1) Understand the request: restate the intended behavior change briefly.
2) Locate the smallest correct change.
3) Implement with bounded control flow + clear error handling.
4) Run the narrowest verification first (unit test, typecheck, lint), then broader checks if needed.
5) Summarize what changed and how it was validated.

## Guardrails

- Do not change public APIs or behavior unless requested.
- Do not “clean up” unrelated code while fixing something.
- Do not add new dependencies unless there’s a clear need and it’s consistent with the repo.
- When uncertain, ask a targeted question or add a small diagnostic that can be removed later.

## Notes

These instructions are inspired by Gerard J. Holzmann’s “Power of 10” safety-critical rules (NASA/JPL), adapted for modern JS/TS, Rust/C++, and mobile app codebases.

