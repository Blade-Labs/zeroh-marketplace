# Component structure

Follow the consumer's design and folder conventions. Split a component when state management or distinct render regions have separate responsibilities, not just to hit a line count. Keep single-consumer helpers nearby; put genuinely shared components in the project's shared home.

Name relevant target paths when planning a UI change. Verify behavior through meaningful logic/integration checks and inspect the actual rendered result for presentation. Avoid tests that mirror class lists or markup bytes. Reuse existing accessibility and interaction checks rather than treating every rendered test as unnecessary.
