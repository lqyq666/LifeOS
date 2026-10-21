# Primary sources — read 2026-10-19

- [Official model pricing](https://help.aliyun.com/zh/model-studio/model-pricing): Beijing Flash section, qwen3.8-flash, 0–1M input bracket, 0.8 input /2.7 output CNY per million. Price is not account balance or availability. Whole-request bracket rule applies. No assumed free quota or Batch discount.
- [Official structured output](https://help.aliyun.com/zh/model-studio/qwen-structured-output): Qwen3.8-Flash listed for JSON Schema. Unsupported array `uniqueItems` produces 400; existing server uniqueness checks remain needed. Account/current actual runtime compatibility still requires a fresh real probe.
- [Official context cache](https://help.aliyun.com/zh/model-studio/context-cache): implicit cache not guaranteed; actual response usage matters. For qwen3.8-flash exact cached-input price is referred to console, not generic 20% discount. Use no discount until known.

Acquisition: agent-reach Exa found official pricing; its snippet was not used as final evidence. Jina result from the preceding reader invocation could not be confirmed from retained tool output. Opened all three original official pages through the available public-web reader fallback (no authenticated console, cookies, clipboard or secret access). Reused `.planning/research/campus-growth/sources.md` only as a starting pointer, not current price evidence.

Inferences: conservative per-call ceiling is 128000×0.8/1000000 +8192×2.7/1000000 =0.1245184. 36×ceiling=4.4826624, above remaining2.10074620; lower typical usage alone is not a guaranteed batch budget. No dispatch or promotion is authorized by this research artifact itself.
