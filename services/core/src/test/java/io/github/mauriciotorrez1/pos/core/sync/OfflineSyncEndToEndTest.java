package io.github.mauriciotorrez1.pos.core.sync;

import static io.github.mauriciotorrez1.pos.core.sync.SyncFixtures.JSON;
import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.security.DeviceFixtures;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/**
 * E1-20 (RF-020, RNF-01, RNF-05): no sale is lost or stored twice when the register sells offline and
 * syncs later. This test starts the real core on a free port over a real PostgreSQL, enrolls a register
 * and runs {@code apps/pos/src/main/sync/offline-sync.e2e.ts}, which is the register's own outbox,
 * synchronizer and HTTP transport: it sells 1,000 times with no network, then pushes through a proxy that
 * cuts one request halfway and loses the answer of another, and replays two delivered batches. Then the
 * database is compared with what the register says it sold (ADR 0066).
 *
 * <p>It needs Node and the dependencies of {@code apps/pos}, so it only runs with
 * {@code POS_OFFLINE_E2E=true}: CI sets it in the Java job, and {@code scripts/run-offline-sync-e2e.sh}
 * sets it locally.
 */
@SpringBootTest(classes = CoreApplication.class, webEnvironment = WebEnvironment.RANDOM_PORT)
@Import(PostgresTestConfiguration.class)
@EnabledIfEnvironmentVariable(named = "POS_OFFLINE_E2E", matches = "true")
class OfflineSyncEndToEndTest {

    private static final long REGISTER_TIMEOUT_MINUTES = 5;

    @LocalServerPort
    private int port;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    @TempDir
    private Path workDirectory;

    private final UUID tenant = Uuid7.next();
    private final UUID register = Uuid7.next();

    @Test
    void aThousandOfflineSalesReachTheCoreOnceEachDespiteCutsAndReplays() throws Exception {
        String credential = DeviceFixtures.enroll(admin, tenant, register);
        Path summaryPath = workDirectory.resolve("register-summary.json");

        int exitCode = runRegister(credential, summaryPath);

        assertThat(exitCode).as("the register side of the test (its output is above)").isZero();
        JsonNode summary = JSON.readTree(Files.readString(summaryPath));
        long sales = summary.get("sales").asLong();
        long totalCents = summary.get("totalCents").asLong();
        assertThat(sales).isEqualTo(1_000);

        assertThat(scalar("SELECT count(*) FROM sale WHERE tenant_id = ? AND register_id = ?", tenant, register))
                .as("sales in the core").isEqualTo(sales);
        assertThat(scalar("SELECT count(DISTINCT id) FROM sale WHERE tenant_id = ?", tenant))
                .as("distinct sales in the core").isEqualTo(sales);
        assertThat(scalar("SELECT coalesce(sum(total_cents), 0) FROM sale WHERE tenant_id = ?", tenant))
                .as("total in cents in the core").isEqualTo(totalCents);
        assertThat(scalar("SELECT coalesce(sum(line_total_cents), 0) FROM sale_line WHERE tenant_id = ?", tenant))
                .as("the lines add up to the same total").isEqualTo(totalCents);
        assertThat(scalar("SELECT coalesce(sum(amount_cents), 0) FROM sale_payment WHERE tenant_id = ?", tenant))
                .as("the cash received adds up to the same total").isEqualTo(totalCents);
        assertThat(saleIdsInTheCore()).as("the very sales the register made").isEqualTo(saleIdsOf(summary));
        assertThat(operationsByStatus()).as("each operation stored once, none in quarantine")
                .isEqualTo(Map.of("accepted", summary.get("operations").asLong()));
    }

    /** Runs the register side with Node, in {@code apps/pos}, and waits for it. */
    private int runRegister(String credential, Path summaryPath) throws IOException, InterruptedException {
        Path registerApp = Path.of("..", "..", "apps", "pos").toAbsolutePath().normalize();
        Path vitest = registerApp.resolve(Path.of("node_modules", "vitest", "vitest.mjs"));
        assertThat(vitest).as("the dependencies of apps/pos are installed (pnpm install)").exists();
        ProcessBuilder builder = new ProcessBuilder("node", vitest.toString(), "run", "--config", "vitest.e2e.config.ts")
                .directory(registerApp.toFile())
                .redirectErrorStream(true);
        Map<String, String> environment = builder.environment();
        environment.put("E2E_CORE_URL", "http://127.0.0.1:" + port);
        environment.put("E2E_DEVICE_TOKEN", credential);
        environment.put("E2E_TENANT_ID", tenant.toString());
        environment.put("E2E_REGISTER_ID", register.toString());
        environment.put("E2E_SUMMARY_PATH", summaryPath.toString());
        environment.put("NO_COLOR", "1");
        Process process = builder.start();
        Thread output = Thread.ofVirtual().start(() -> echo(process));
        if (!process.waitFor(REGISTER_TIMEOUT_MINUTES, TimeUnit.MINUTES)) {
            process.destroyForcibly();
            throw new AssertionError("The register side did not finish in " + REGISTER_TIMEOUT_MINUTES + " minutes");
        }
        output.join();
        return process.exitValue();
    }

    /**
     * Copies the output of the register side to the test's output. Inheriting the descriptors instead
     * would write into the channel Surefire uses to talk to its forked JVM.
     */
    private static void echo(Process process) {
        try (BufferedReader reader = process.inputReader(StandardCharsets.UTF_8)) {
            reader.lines().forEach(line -> System.out.println("[register] " + line));
        } catch (IOException | UncheckedIOException closed) {
            System.out.println("[register] output ended: " + closed.getMessage());
        }
    }

    private long scalar(String sql, Object... arguments) {
        Long value = admin.queryForObject(sql, Long.class, arguments);
        return value == null ? 0 : value;
    }

    private Set<String> saleIdsInTheCore() {
        return new HashSet<>(admin.queryForList("SELECT id::text FROM sale WHERE tenant_id = ?", String.class, tenant));
    }

    private static Set<String> saleIdsOf(JsonNode summary) {
        List<String> ids = new ArrayList<>();
        summary.get("saleIds").forEach(id -> ids.add(id.asString()));
        return new HashSet<>(ids);
    }

    private Map<String, Long> operationsByStatus() {
        Map<String, Long> counts = new HashMap<>();
        admin.query("SELECT status, count(*) FROM sync_operation WHERE tenant_id = ? AND register_id = ? GROUP BY status",
                row -> {
                    counts.put(row.getString(1), row.getLong(2));
                }, tenant, register);
        return counts;
    }
}
