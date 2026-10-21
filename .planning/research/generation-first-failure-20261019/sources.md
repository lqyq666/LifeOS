# Sources: generation first failure

Checked 2026-10-19, technical compatibility only; no pricing, balance or purchase investigation.

- 20:52 re-read [Qwen API parameters](https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope) through agent-reach/Jina. The presence_penalty section documents range -2 to2 and default1.5 for Qwen3.8 nonthinking, not Max alone. This justifies testing/restoring Flash's documented default instead of assuming zero. No personal context/credentials sent to the reader. Single-variable runtime diagnostic1.5 eliminated terminal repetition but still violated summary question patterns; it is not a complete fix by itself.
- Appending only the existing summary contract's no-question instruction to that same1.5 body produced a canonical/native-valid response once. This is a recorded hypothesis test, not a substitute for final-source ordinary engine semantics, full36 or real latency gates. Native schema/output ceiling/model/endpoint unchanged during these two diagnostic steps.

- [Structured output](https://help.aliyun.com/zh/model-studio/qwen-structured-output): Flash family support, schema keyword restrictions and warning about `max_tokens`. Read through agent-reach's Jina public-reader route, corroborated by the built-in official-page reader. No credentials or user payload were sent to either reader.
- [OpenAI Chat compatibility](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope): workspace endpoint recommendation and explicit continued usability of existing domains. This rules out treating a newer example URL as proof that the old endpoint is invalid.
- [API key configuration](https://help.aliyun.com/zh/model-studio/get-api-key): regional binding and the Beijing compatibility base URL. This page is documentation, not proof of this account's generation permission.
- Existing `.planning/research/flash-budget-continuation-20261019/sources.md` was consulted only for the prior structured-output source; its cost investigation was not resumed.
- Local SDK construction: `.local/diagnose-capability-payload-offline.ts`, `server/model.ts`, `server/model-payload.ts`. The zero-network report stores wire metadata and a schema digest, not credential/header values or a successful provider response.
- Local red/green diagnostic receipts: `evidence/grilling/launch-diagnostics-red-20261019.json` and `launch-diagnostics-green-20261019.json`.

Search boundary: the configured Exa route returned a search quota error. No new key, subscription or allowance was created. The existing public official-page reader was used for the narrow fallback. No global provider-outage conclusion was reached.
