package io.github.mauriciotorrez1.pos.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Makes the core an OAuth2 resource server (ADR 0039): every request needs a valid Keycloak JWT
 * except the health probe, and the tenant of the token is pinned for the whole request.
 */
@Configuration(proxyBeanMethods = false)
@Import(MeController.class)
public class SecurityConfiguration {

    /**
     * Builds the filter chain of the API: stateless, bearer tokens only, tenant taken from the token.
     *
     * @param http the Spring Security builder
     * @return the chain applied to every request
     * @throws Exception if the chain cannot be built
     */
    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
        return http
                // No cookies and no sessions: a browser never attaches a bearer token on its own, so CSRF does not apply.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(requests -> requests
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
                .addFilterAfter(new TenantFromTokenFilter(), BearerTokenAuthenticationFilter.class)
                .build();
    }
}
