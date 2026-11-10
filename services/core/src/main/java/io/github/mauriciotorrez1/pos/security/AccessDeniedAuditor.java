package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Writes an audit entry for every request denied to a signed-in user (RF-008). It stores the rule
 * that denied the request, never the real path or the body, because those can carry personal data.
 */
class AccessDeniedAuditor {

    private static final Logger LOG = LoggerFactory.getLogger(AccessDeniedAuditor.class);

    private final AuditLog auditLog;
    private final TransactionTemplate transaction;

    AccessDeniedAuditor(AuditLog auditLog, TransactionTemplate transaction) {
        this.auditLog = auditLog;
        this.transaction = transaction;
    }

    /**
     * Records a denial. It never throws: a failure to audit must not turn a denial into a server error.
     *
     * @param user    who was denied, or {@code null} when the token matches no active user
     * @param method  the HTTP method of the request
     * @param rule    the rule that denied it, or {@code null} when no rule matched the request
     * @param reason  why it was denied: {@code no_user}, {@code missing_permission} or {@code unlisted_endpoint}
     */
    void record(PosAuthentication user, String method, EndpointRule rule, String reason) {
        if (TenantContext.current().isEmpty()) {
            return;
        }
        String pattern = rule == null ? "unlisted" : rule.pattern();
        String permission = rule == null || rule.permission() == null ? "none" : rule.permission().id();
        String role = user == null ? "none" : user.user().role().value();
        String detail = "{\"method\": \"" + method + "\", \"rule\": \"" + pattern + "\", \"permission\": \""
                + permission + "\", \"role\": \"" + role + "\", \"reason\": \"" + reason + "\"}";
        UUID entityId = UUID.nameUUIDFromBytes((method + " " + pattern).getBytes(StandardCharsets.UTF_8));
        try {
            transaction.executeWithoutResult(status -> auditLog.record(new AuditEntry(
                    user == null ? null : user.user().id(), "access.denied", "endpoint", entityId, null, detail)));
        } catch (RuntimeException e) {
            LOG.error("Could not audit a denied request ({} {})", method, pattern, e);
        }
    }
}
