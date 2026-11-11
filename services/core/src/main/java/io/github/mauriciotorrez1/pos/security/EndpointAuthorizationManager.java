package io.github.mauriciotorrez1.pos.security;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * Decides every request against the endpoint table (ADR 0042). The first rule that matches wins;
 * a request that matches none is denied, and a denial to a signed-in user is audited.
 */
final class EndpointAuthorizationManager implements AuthorizationManager<RequestAuthorizationContext> {

    private record CompiledRule(EndpointRule rule, RequestMatcher matcher) {
    }

    private final List<CompiledRule> rules;
    private final AccessDeniedAuditor auditor;

    EndpointAuthorizationManager(List<EndpointRule> rules, AccessDeniedAuditor auditor) {
        this.rules = rules.stream().map(rule -> new CompiledRule(rule, rule.matcher())).toList();
        this.auditor = auditor;
    }

    @Override
    public AuthorizationDecision authorize(Supplier<? extends Authentication> authentication, RequestAuthorizationContext context) {
        HttpServletRequest request = context.getRequest();
        Optional<EndpointRule> rule = rules.stream()
                .filter(candidate -> candidate.matcher().matches(request))
                .map(CompiledRule::rule)
                .findFirst();
        if (rule.isPresent() && rule.get().access() == EndpointRule.Access.PUBLIC) {
            return new AuthorizationDecision(true);
        }
        Authentication current = authentication.get();
        if (current instanceof DeviceAuthentication) {
            // A register opens only the endpoints made for registers, and nothing else.
            return new AuthorizationDecision(rule.isPresent() && rule.get().access() == EndpointRule.Access.DEVICE);
        }
        if (!(current instanceof org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken)) {
            // Not signed in: Spring answers 401. Nothing to audit, there is no user and no business.
            return new AuthorizationDecision(false);
        }
        PosAuthentication user = current instanceof PosAuthentication known ? known : null;
        if (rule.isEmpty()) {
            auditor.record(user, request.getMethod(), null, "unlisted_endpoint");
            return new AuthorizationDecision(false);
        }
        if (rule.get().access() == EndpointRule.Access.AUTHENTICATED) {
            return new AuthorizationDecision(true);
        }
        if (rule.get().access() == EndpointRule.Access.DEVICE) {
            auditor.record(user, request.getMethod(), rule.get(), "device_credential_required");
            return new AuthorizationDecision(false);
        }
        if (user == null) {
            auditor.record(null, request.getMethod(), rule.get(), "no_user");
            return new AuthorizationDecision(false);
        }
        boolean allowed = rule.get().permission().grantedTo(user.user().role());
        if (!allowed) {
            auditor.record(user, request.getMethod(), rule.get(), "missing_permission");
        }
        return new AuthorizationDecision(allowed);
    }
}
