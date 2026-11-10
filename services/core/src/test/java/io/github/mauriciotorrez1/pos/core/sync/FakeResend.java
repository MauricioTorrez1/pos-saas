package io.github.mauriciotorrez1.pos.core.sync;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** A fake of the Resend API: records what it receives and answers with the statuses a test scripts. */
final class FakeResend {

    /** One request that reached the fake. */
    record Received(String authorization, String idempotencyKey, JsonNode body) {
    }

    private final HttpServer server;
    private final List<Received> received = new CopyOnWriteArrayList<>();
    private final Deque<Integer> script = new ArrayDeque<>();
    private volatile int defaultStatus = 200;
    private volatile long delayMillis;

    FakeResend() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        server.createContext("/emails", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            received.add(new Received(exchange.getRequestHeaders().getFirst("Authorization"),
                    exchange.getRequestHeaders().getFirst("Idempotency-Key"), JsonMapper.builder().build().readTree(body)));
            if (delayMillis > 0) {
                try {
                    Thread.sleep(delayMillis);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            int status;
            synchronized (script) {
                status = script.isEmpty() ? defaultStatus : script.poll();
            }
            byte[] answer = "{\"id\":\"fake\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, answer.length);
            exchange.getResponseBody().write(answer);
            exchange.close();
        });
        server.start();
    }

    String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    List<Received> received() {
        return received;
    }

    /** Forgets what was received and scripted, and answers 200 again. */
    void reset() {
        received.clear();
        synchronized (script) {
            script.clear();
        }
        defaultStatus = 200;
        delayMillis = 0;
    }

    /** The next answers, one per request; after them the default status applies. */
    void script(Integer... statuses) {
        synchronized (script) {
            script.addAll(List.of(statuses));
        }
    }

    void alwaysAnswer(int status) {
        defaultStatus = status;
    }

    void delayAnswers(long millis) {
        delayMillis = millis;
    }
}
