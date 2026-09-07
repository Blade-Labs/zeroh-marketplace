# Durable native-run ownership

Verdict: PROCEED_WITH_FIX, native Sol fallback requested; exact runtime unverified. The earlier external Fable disclosure refusal remains respected; no Fable consultation is claimed.

Use the existing sidecar publication pattern: write a private temporary file, fsync, atomically link the immutable destination, fsync its directory, and remove only the owned temporary file. Extract this narrow primitive from sidecar.mjs for the existing result claims, run receipts and run-bound executor arm. A compare followed by rename is not cross-process CAS.

Run receipts are immutable numbered full-state revisions addressed by arcId and runId under the existing canonical building directory. Each revision binds its predecessor digest and the actual request, operation and result bytes. Read a contiguous validated chain; unsafe paths, malformed records and gaps refuse without mutation. Each snapshot retains only the latest normalized semantic observation. It never recopies all prior observations or stores native token/progress logs. Prior revisions provide exact duplicate-event evidence.

Request and action fingerprints are computed by code. The caller supplies actual role-card/governance bytes and an operation with its payload, then reuses the returned receipt digest for CAS. No model predicts a hash or retypes an executable. Request publication precedes native start; action publication precedes that action. An unknown external outcome holds for reconciliation and never authorizes a replay. A terminal result is accepted once; an exact repeat is a duplicate, a different result is a conflict.

An ordinary delayed observation never acknowledges a pending action. Only an explicit actionAcknowledgement from the direct successful performAction return may clear it, after code recomputes the actual operation fingerprint and checks the bound native session. A crash before this durable acknowledgment holds; a terminal result can still end the run. This adds no lifecycle or AgentRunReceipt schema vocabulary.

The existing arm owns only stable identity: sessionId, executorId, runId and requestFingerprint. claimExecutorRun consumes the recorded pre-start receipt and publishes that immutable binding. Native session and action identity change only in RunReceipt. Legacy/partial or different incumbent arms are preserved and hold. There is no arm update journal, age-based takeover, new scheduler or lock service.

Extend the existing beacon reader to preserve optional run identity and receipt-digest fields without changing legacy absent-field output. A beacon referencing an older receipt revision is legitimate: compare its identity to that exact revision. Missing identity remains liveness evidence only; inconsistent or unparseable relevant evidence cannot advance a run. The existing executor-arm owner joins arm/beacon evidence; receipt code owns persistence validity, while reduceArcTransition remains the lifecycle owner.

Approved task scope additions: sidecar.mjs/test for the shared immutable publisher, agent-driver.mjs/test for exported existing validation guards, and beacon.mjs/test for identity projection. Existing run-receipt.mjs/test and executor-arm.mjs/test remain the primary task files. No schema, workflow, concrete native adapter, new dependency or lifecycle-engine work belongs to this task.
