FROM pulumi/pulumi-nodejs:3.258.0

USER root

RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/pulumi-local \
  && /opt/pulumi-local/bin/pip install --no-cache-dir pulumi-local==1.3.0 \
  && npm install --global pnpm@10.19.0

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY systems/03-fulfillment/packages/contracts/package.json ./systems/03-fulfillment/packages/contracts/package.json
COPY systems/03-fulfillment/lambdas/package.json ./systems/03-fulfillment/lambdas/package.json
COPY systems/03-fulfillment/infra/package.json ./systems/03-fulfillment/infra/package.json

RUN pnpm install --frozen-lockfile \
  --filter @fulfillment/contracts \
  --filter @openwizard/fulfillment-lambdas \
  --filter @openwizard/fulfillment-infra

COPY systems/03-fulfillment/packages/contracts ./systems/03-fulfillment/packages/contracts
COPY systems/03-fulfillment/lambdas ./systems/03-fulfillment/lambdas
COPY systems/03-fulfillment/infra ./systems/03-fulfillment/infra

WORKDIR /workspace/systems/03-fulfillment

ENV PATH="/opt/pulumi-local/bin:${PATH}" \
  AWS_REGION=us-east-1 \
  AWS_ENDPOINT_URL=http://localstack:4566 \
  PULUMI_BACKEND_URL=file:///state \
  PULUMI_SKIP_UPDATE_CHECK=true

VOLUME ["/state"]

ENTRYPOINT ["pnpm", "--dir", "infra"]
CMD ["local:up"]
