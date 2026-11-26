# Tools of the backups (ADR 0082): pg_dump, pg_restore and psql 17 (the line of Supabase) plus age.
# The daily backup and the restore test both run the scripts of this folder inside this image, so the test
# exercises exactly the tools production uses.
FROM postgres:17.12@sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf

RUN apt-get update \
    && apt-get install --yes --no-install-recommends age \
    && rm -rf /var/lib/apt/lists/*

COPY create-backup.sh restore-backup.sh /usr/local/bin/
# The image never runs a server; it only runs the scripts as an unprivileged user.
USER postgres
WORKDIR /tmp
ENTRYPOINT []
