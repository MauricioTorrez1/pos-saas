package io.github.mauriciotorrez1.pos.security;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Talks to a Keycloak started for a test: creates users and signs them in to get real access tokens. */
public class KeycloakTestClient {

    private static final String CLIENT = "pos-panel";
    private static final String PASSWORD = "test-user-password-1";

    private final String baseUrl;
    private final HttpClient http = HttpClient.newHttpClient();
    private final JsonMapper json = JsonMapper.builder().build();

    KeycloakTestClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * Lets the panel client use the password grant, which the realm keeps off. Only the tests need
     * it: a real login uses the authorization code flow with PKCE.
     */
    void allowPasswordGrant() {
        JsonNode client = get("/admin/realms/" + KeycloakTestConfiguration.REALM + "/clients?clientId=" + CLIENT).get(0);
        ((tools.jackson.databind.node.ObjectNode) client).put("directAccessGrantsEnabled", true);
        send(HttpRequest.newBuilder(uri("/admin/realms/" + KeycloakTestConfiguration.REALM + "/clients/" + client.get("id").asString()))
                .header("Authorization", "Bearer " + adminToken())
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(client.toString())), 204);
    }

    /**
     * Creates a user of the realm.
     *
     * @param username the login name
     * @param tenantId the business to store in the {@code tenant_id} attribute, or {@code null} for none
     */
    void createUser(String username, UUID tenantId) {
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("username", username);
        user.put("enabled", true);
        user.put("credentials", List.of(Map.of("type", "password", "value", PASSWORD, "temporary", false)));
        if (tenantId != null) {
            user.put("attributes", Map.of("tenant_id", List.of(tenantId.toString())));
        }
        send(HttpRequest.newBuilder(uri("/admin/realms/" + KeycloakTestConfiguration.REALM + "/users"))
                .header("Authorization", "Bearer " + adminToken())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(user))), 201);
    }

    /**
     * Signs a user in and returns the access token.
     *
     * @param username the login name
     * @return the compact JWT
     */
    String accessToken(String username) {
        return token(KeycloakTestConfiguration.REALM, CLIENT, username, PASSWORD);
    }

    private String adminToken() {
        return token("master", "admin-cli", KeycloakTestConfiguration.ADMIN_USER, KeycloakTestConfiguration.ADMIN_PASSWORD);
    }

    /** A token from the master realm: valid and signed by Keycloak, but from another issuer. */
    String foreignRealmToken() {
        return adminToken();
    }

    private String token(String realm, String clientId, String username, String password) {
        String form = "grant_type=password&scope=openid&client_id=" + encode(clientId)
                + "&username=" + encode(username) + "&password=" + encode(password);
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/realms/" + realm + "/protocol/openid-connect/token"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form)), 200);
        return json.readTree(response.body()).get("access_token").asString();
    }

    private JsonNode get(String path) {
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri(path))
                .header("Authorization", "Bearer " + adminToken()).GET(), 200);
        return json.readTree(response.body());
    }

    private HttpResponse<String> send(HttpRequest.Builder request, int expectedStatus) {
        try {
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != expectedStatus) {
                throw new IllegalStateException("Keycloak answered " + response.statusCode() + " to " + response.uri());
            }
            return response;
        } catch (IOException e) {
            throw new IllegalStateException("Keycloak is not reachable", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while calling Keycloak", e);
        }
    }

    private URI uri(String path) {
        return URI.create(baseUrl + path);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
