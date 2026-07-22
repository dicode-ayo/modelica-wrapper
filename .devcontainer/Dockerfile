# OMC version is the single source of truth — Renovate's `dockerfile` manager
# tracks `openmodelica/openmodelica` Docker Hub tags. The custom regex manager
# in `renovate.json` keeps `SUPPORTED_OMC.primary` in
# `packages/omc-client/src/version.ts` in sync via the same OpenModelica
# GitHub release datasource.
FROM openmodelica/openmodelica:v1.27.0-minimal

ENV DEBIAN_FRONTEND=noninteractive

# Node.js 20 (LTS) + git + pnpm. The `-minimal` OMC image is Ubuntu-based but
# slim — install the dev tooling we need explicitly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates curl gnupg git sudo \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g pnpm@10.25.0 \
  && rm -rf /var/lib/apt/lists/*

# Devcontainer "vscode" user — VSCode mounts the workspace as this UID.
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN if ! id -u $USERNAME >/dev/null 2>&1; then \
      groupadd --gid $USER_GID $USERNAME \
      && useradd --uid $USER_UID --gid $USER_GID -m -s /bin/bash $USERNAME \
      && echo "$USERNAME ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME \
      && chmod 0440 /etc/sudoers.d/$USERNAME; \
    fi

USER $USERNAME
WORKDIR /workspaces/modelica-wrapper

# Claude Code CLI — installed as the non-root devcontainer user so OAuth
# credentials land in /home/$USERNAME/.claude/ (mode 0600), not /root.
# Subscription users auth via browser on first run; Console-API users can
# set ANTHROPIC_API_KEY (forwarded from the host via devcontainer.json's
# remoteEnv).
RUN curl -fsSL https://claude.ai/install.sh | bash

# Surface the installer's bin dir on PATH for non-login shells.
ENV PATH="/home/${USERNAME}/.local/bin:${PATH}"

# Sanity: confirm omc + node + pnpm + claude are all on PATH at build time.
RUN omc --version && node --version && pnpm --version && claude --version
