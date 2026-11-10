package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import jakarta.servlet.DispatcherType;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Makes the core an OAuth2 resource server (ADR 0039): every request needs a valid Keycloak JWT
 * except the health probe, the tenant of the token is pinned for the whole request, and the role of
 * the user decides what it may call (ADR 0042).
 */
@Configuration(proxyBeanMethods = false)
@Import(MeController.class)
public class SecurityConfiguration {

    /**
     * Builds the filter chain of the API: stateless, bearer tokens only, tenant taken from the token
     * and every request checked against the endpoint table.
     *
     * @param http          the Spring Security builder
     * @param directory     where the user of a token is looked up
     * @param authorization the manager that applies the endpoint table
     * @return the chain applied to every request
     * @throws Exception if the chain cannot be built
     */
    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http, UserDirectory directory,
                                    EndpointAuthorizationManager authorization) throws Exception {
        return http
                // No cookies and no sessions: a browser never attaches a bearer token on its own, so CSRF does not apply.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(requests -> requests
                        // The error page of a 404 or a 400 is a second dispatch of the same request, already authorized once.
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
                        .anyRequest().access(authorization))
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
                .addFilterAfter(new TenantFromTokenFilter(), BearerTokenAuthenticationFilter.class)
                .addFilterAfter(new UserRoleFilter(directory), TenantFromTokenFilter.class)
                .build();
    }

    /**
     * Creates the manager that applies {@link EndpointPermissions#RULES} plus any rule that another
     * part of the application, or a test, registers as a bean.
     *
     * @param extraRules the additional rules, if any
     * @param auditLog   where denials are recorded
     * @param transaction the transaction template of the application
     * @return the manager
     */
    @Bean
    EndpointAuthorizationManager endpointAuthorizationManager(ObjectProvider<EndpointRule> extraRules, AuditLog auditLog,
                                                              TransactionTemplate transaction) {
        List<EndpointRule> rules = new ArrayList<>(EndpointPermissions.RULES);
        extraRules.orderedStream().forEach(rules::add);
        return new EndpointAuthorizationManager(rules, new AccessDeniedAuditor(auditLog, transaction));
    }
}
