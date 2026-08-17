# syntax=docker/dockerfile:1
#
# Two stages: build the bundle, then serve it. The final image contains no Node, no toolchain, no
# source and no secret — an SPA is static files, and everything else in the image is attack surface
# for something it does not need to do.
#
# THE IMAGE CARRIES NO ENVIRONMENT. It is built once, tagged once, and the same tag is promoted from
# staging to production; the hosts it talks to are resolved in the browser from the address the page
# was served on (src/lib/hosts.ts). There is deliberately no build arg for an API URL.
#
# The version of that rule particular to this surface: a baked-in API origin would not break a page,
# it would produce a WORKING one that writes to the wrong square. A reader on the testnet hostname,
# with the amber band on screen, would compose a post and publish it to mainnet in front of
# everybody. There is no revert for that — it is not a transaction, it is a sentence somebody said.
# The origin is derived from the page address and the viewed network, so the band and the square can
# never disagree.
#
# THERE IS NO SERVICE TOKEN IN THIS IMAGE. Every authenticated call this bundle makes carries the
# READER'S OWN bearer, obtained from the Account portal in their browser and held in their own
# localStorage. A credential inside an image is a published credential whatever it was for: images
# are pushed to a registry and pulled by anything with read access. `nginx.conf` proxies nothing and
# CI greps both files.

# The named context is the unpublished @cloudsforge/ui workspace, mirroring the `link:` specifier in
# package.json. It disappears when the package is published; see the README.
#   docker build -t agora-web --build-context uipkg=../ui .

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# The linked package must exist before `pnpm install` resolves the `link:` dependency, and it is
# copied first because it changes far less often than this app's source.
COPY --from=uipkg packages/ui /ui/packages/ui
# esbuild reads the nearest tsconfig for each file it transforms, and the design system's extends the
# one at its repository root. Without it the build fails inside a file this app does not own.
COPY --from=uipkg tsconfig.base.json /ui/tsconfig.base.json

# pnpm-workspace.yaml carries the esbuild build-script allowance; without it the toolchain installs
# and then cannot run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# public/ — Vite copies `publicDir` into `dist` during the build, so the favicons and the og card
# only reach the image if they are in the build context. The web template's Dockerfile used to copy
# tsconfig, vite.config, index.html and src — and not public — so every frontend cut from it built an
# image whose `dist/` had no favicon in it, while `brand-chrome.test.ts` went on passing because it
# reads the SOURCE tree. Both that test (which reads this file) and the image probe in ci.yml (which
# curls the running container for each asset) fail without this line.
COPY public ./public

# The release identity: the git sha, stamped into the meta tag src/lib/obs.ts reads, so an error
# report names the deploy that produced it. It identifies the artefact; it does not configure it.
ARG RELEASE=dev
RUN sed -i "s|name=\"cf-release\" content=\"dev\"|name=\"cf-release\" content=\"${RELEASE}\"|" index.html \
 && pnpm build

# nginx-unprivileged: the server runs as uid 101 and listens on 8080. A static file server has no
# reason to be root, and a container that cannot become root cannot be made to write anywhere.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

# Liveness only. It proves nginx is answering, not that the app works: the timelines, the composer
# and every button on this surface are micro-agora, which is a different container and answers on a
# different hostname. A green probe here is compatible with the square being unreadable.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
