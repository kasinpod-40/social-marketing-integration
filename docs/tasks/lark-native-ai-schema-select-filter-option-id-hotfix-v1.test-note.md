# Verification note — Option-ID resume regression

The focused integration regression `tests/application/lark-native-ai-schema-apply-option-id-resume.test.js` reconstructs the exact accepted partial boundary:

```text
23 additive Fields present
2 Select extensions present
🌐 All Channel Readiness present
📊 Executive Summaries present with empty filter
4 required Views absent
```

It verifies that a resume:

- performs zero Field create/update requests;
- configures the existing Executive View;
- creates only the remaining four Views;
- sends five View updates total;
- uses live Select option IDs instead of logical names;
- preserves Checkbox values as Booleans;
- reaches final zero drift and exact filter parity.
