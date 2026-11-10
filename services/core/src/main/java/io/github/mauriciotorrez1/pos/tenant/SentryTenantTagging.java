package io.github.mauriciotorrez1.pos.tenant;

import io.sentry.SentryOptions;
import org.springframework.stereotype.Component;

/** Tags each Sentry error with the tenant, so an error can be traced to one business without personal data. */
@Component
public class SentryTenantTagging implements SentryOptions.BeforeSendCallback {

    @Override
    public io.sentry.SentryEvent execute(io.sentry.SentryEvent event, io.sentry.Hint hint) {
        TenantContext.current().ifPresent(tenant -> event.setTag(TenantContext.MDC_KEY, tenant.toString()));
        return event;
    }
}
