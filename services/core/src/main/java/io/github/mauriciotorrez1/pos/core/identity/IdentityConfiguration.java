package io.github.mauriciotorrez1.pos.core.identity;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Beans of the identity module. */
@Configuration(proxyBeanMethods = false)
class IdentityConfiguration {

    /**
     * The clock that PIN locks and code expiry read, so tests can move time without waiting five minutes.
     *
     * @return the system clock in UTC
     */
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
