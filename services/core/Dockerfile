# syntax=docker/dockerfile:1
# Image of the core for Cloud Run (ADR 0079). Tests do not run here: the Java check of CI already ran them
# on the same commit before it reached main.
# Build from the repository root, since the jar embeds packages/contracts/schemas:
#   docker build --file services/core/Dockerfile --tag pos-core .

FROM eclipse-temurin:21-jdk-noble@sha256:dc333cdac241f073941f043792f2a2f9b790bfe7cd98ef2843c08880986708de AS build
WORKDIR /workspace/services/core

# Without unzip the Maven wrapper fetches the .tar.gz, whose checksum is not the pinned one of the .zip.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, so a change in src/ reuses this layer.
COPY services/core/.mvn .mvn
COPY services/core/mvnw services/core/pom.xml ./
RUN --mount=type=cache,target=/root/.m2 ./mvnw --batch-mode --no-transfer-progress dependency:go-offline

COPY packages/contracts/schemas /workspace/packages/contracts/schemas
COPY services/core/src/main src/main
RUN --mount=type=cache,target=/root/.m2 ./mvnw --batch-mode --no-transfer-progress package -DskipTests \
    && cp target/core-*.jar core.jar \
    && java -Djarmode=tools -jar core.jar extract --destination extracted

FROM eclipse-temurin:21-jre-noble@sha256:54999a956a8bf8be9af0052790a6a832bf91a62fad3199fd194c3cc28057fc62
WORKDIR /app

# The extracted layout (application jar plus lib/) starts faster than the nested fat jar.
COPY --from=build /workspace/services/core/extracted/ ./

# A user without a shell or home of its own; the JVM never runs as root.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin core
USER core

ENV SPRING_PROFILES_ACTIVE=prod \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:TieredStopAtLevel=1 -XX:+UseSerialGC"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "core.jar"]
