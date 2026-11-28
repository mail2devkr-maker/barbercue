# Neon CU guard as a Railway cron job (see README "Running on Railway"). Same script as the GitHub
# workflow; Railway starts this container on its cron schedule and the process exits when done.
FROM node:22-bookworm-slim
RUN apt-get update -q \
  && apt-get install -y -q --no-install-recommends postgresql-common ca-certificates \
  && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
  && apt-get install -y -q --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/lib/postgresql/18/bin:${PATH}" GUARD_RUNNER=railway
WORKDIR /guard
COPY lib.mjs lib.test.mjs guard.mjs ./
# A failing decision-logic test stops the guard before it can act, exactly as in the workflow.
CMD ["sh", "-c", "node --test lib.test.mjs && pg_dump --version && node guard.mjs"]
