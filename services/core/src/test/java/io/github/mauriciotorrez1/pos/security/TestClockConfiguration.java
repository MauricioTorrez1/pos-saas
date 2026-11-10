package io.github.mauriciotorrez1.pos.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Replaces the clock of the core with one the tests can move, so a five-minute lock needs no waiting. */
@TestConfiguration(proxyBeanMethods = false)
public class TestClockConfiguration {

    /** A clock that only moves when a test says so. */
    public static final class MutableClock extends Clock {

        private final AtomicReference<Instant> now = new AtomicReference<>(Instant.now());

        /**
         * Moves the clock forward.
         *
         * @param amount how much time passes
         */
        public void advance(Duration amount) {
            now.updateAndGet(current -> current.plus(amount));
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now.get();
        }
    }

    @Bean
    @Primary
    MutableClock mutableClock() {
        return new MutableClock();
    }
}
