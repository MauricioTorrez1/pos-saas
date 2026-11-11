package io.github.mauriciotorrez1.pos.core.reporting.resend;

import io.github.mauriciotorrez1.pos.core.reporting.EmailSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Registers the Resend sender. Without a key the core still starts and the reports are skipped with a warning. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ResendProperties.class)
class ResendConfiguration {

    private static final Logger LOG = LoggerFactory.getLogger(ResendConfiguration.class);

    @Bean
    EmailSender emailSender(ResendProperties properties) {
        if (!properties.isConfigured()) {
            LOG.warn("RESEND_API_KEY or RESEND_FROM is empty: cash cut reports will not be e-mailed");
        }
        return new ResendEmailSender(properties);
    }
}
