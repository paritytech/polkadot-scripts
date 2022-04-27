FROM docker.io/library/node:18 as builder

WORKDIR /opt/builder

COPY . .

RUN yarn install && \
    yarn build

# Pending yarn binary once executable is working
#RUN yarn install && \
#    yarn binary

FROM docker.io/library/node:18.0-bullseye-slim

ARG VERSION
ARG VCS_REF
ARG BUILD_DATE

LABEL io.parity.image.authors="devops-team@parity.io" \
    io.parity.image.vendor="Parity Technologies" \
    io.parity.image.title="parity/polkadot-scripts" \
    io.parity.image.description="Polkadot Scripts" \
    io.parity.image.source="https://github.com/paritytech/polkadot-scripts/blob/${VCS_REF}/Dockerfile" \
    io.parity.image.revision="${VCS_REF}" \
    io.parity.image.created="${BUILD_DATE}"


WORKDIR /polkadot-scripts

# Temporary solution to run the script
COPY --from=builder /opt/builder  /polkadot-scripts
CMD ["node", "build/index.js", "--version"]

# To be used once binaries are available
# COPY --from=builder /opt/builder/binaries  /usr/local/bin
# CMD [ "polkadot-scripts", "--version" ]
