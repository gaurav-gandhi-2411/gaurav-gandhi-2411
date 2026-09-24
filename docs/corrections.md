# Corrections

I keep a written record of measurements that turned out to be lying, and of whatever caught each one. Twenty-eight write-ups so far. Some are checks I broke on purpose to see whether they would notice.

| What the check reported | What was actually true |
|:------------------------|:-----------------------|
| A header test confirmed the nav band shrinks on scroll. | It did, and the shrinking was the bug. The band sat in flow, so every element below it moved too. The test had been written after reading the code, so it could only ever agree with it. |
| A quality gate printed that all thresholds pass, retrieval at 100%. | One test case had been deleted, the single case the retriever got wrong. The score went from 95.0% to 100% by removing the question. |

Both are fixed, and both fixes were checked against a build with the fix reverted.

[← Back to the profile README](../README.md)
