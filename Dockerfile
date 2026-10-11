# Exact official image digest verified from the installed Docker image.
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts
COPY index.html companion-preview.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY server ./server
COPY skills ./skills
COPY public ./public
RUN npm run build

FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea AS encoder
COPY deploy/requirements-embedding.lock /requirements.lock
COPY .local/docker-embedding/wheels /wheels
RUN python -m venv /opt/encoder && /opt/encoder/bin/pip install --no-index --find-links=/wheels --require-hashes --only-binary=:all: -r /requirements.lock && /opt/encoder/bin/pip check

FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea
ENV NODE_ENV=production LIFEOS_EMBEDDING_PYTHON=/opt/encoder/bin/python \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HOME=/tmp/huggingface PYTHONDONTWRITEBYTECODE=1 \
    LIFEOS_EVIDENCE=/app/evidence/v1.3-action-coach/provider/qwen-default
WORKDIR /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=encoder /opt/encoder /opt/encoder
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --no-create-home node
# tsx remains at its already locked version. Development tools are not exposed as services.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY server ./server
COPY src ./src
COPY skills ./skills
COPY .planning/research/evergreen/KB_GUIDES.jsonl .planning/research/evergreen/KB_SOURCE_REGISTRY.jsonl .planning/research/evergreen/KB_EVIDENCE.jsonl .planning/research/evergreen/KB_CONTENT_REVISIONS.json .planning/research/evergreen/KB_COVERAGE.json .planning/research/evergreen/KB_RETRIEVAL_EXPRESSIONS.json ./.planning/research/evergreen/
COPY scripts/migrate-db.ts scripts/probe-model.ts scripts/create-user.ts scripts/manage-access.ts scripts/manage-provider-budget.ts scripts/coach-provider-budget.ts scripts/coach-source-freeze.ts scripts/coze-host-permit.ts scripts/coze-credit-budget.ts ./scripts/
COPY evidence/v1.3-action-coach/provider/qwen-default/coach-capabilities-default.json evidence/v1.3-action-coach/provider/qwen-default/coach-capabilities-default.json.interface-proof.json ./evidence/v1.3-action-coach/provider/qwen-default/
COPY .local/models/bge-small-zh-v1.5 ./.local/models/bge-small-zh-v1.5
COPY deploy/requirements-embedding.lock ./deploy/requirements-embedding.lock
ARG LIFEOS_BUILD_COMMIT
RUN node -e "const fs=require('node:fs');const commit=process.env.LIFEOS_BUILD_COMMIT;if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('BUILD_COMMIT_REQUIRED');fs.writeFileSync('deploy/build-version.json',JSON.stringify({commit}));"
USER node
EXPOSE 8787
CMD ["node","--import","tsx","server/index.ts"]
