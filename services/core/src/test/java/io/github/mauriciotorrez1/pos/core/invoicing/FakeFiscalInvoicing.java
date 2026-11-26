package io.github.mauriciotorrez1.pos.core.invoicing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/** A stand-in for Facturapi: it remembers what it stamped by external id and fails on demand. */
class FakeFiscalInvoicing implements FiscalInvoicing {

    /** What the next {@link #createInvoice} does. */
    enum Mode {
        /** Stamps and answers. */
        SUCCEED,
        /** Answers 4xx without stamping. */
        REJECT,
        /** Stamps, but the answer is lost (timeout). */
        STAMP_THEN_TIME_OUT,
        /** Does not stamp and does not answer (5xx before doing anything). */
        FAIL_WITHOUT_STAMPING,
        /** No API key. */
        NOT_CONFIGURED
    }

    /** What the next {@link #cancelInvoice} does. */
    enum CancelMode {
        /** The SAT cancels it at once (no acceptance needed). */
        ACCEPT,
        /** The receiver must accept: the cancellation stays pending. */
        PENDING,
        /** Answers 4xx without cancelling. */
        REJECT,
        /** Cancels, but the answer is lost (timeout). */
        ACCEPT_THEN_TIME_OUT,
        /** No API key. */
        NOT_CONFIGURED
    }

    /**
     * A cancellation the fake received.
     *
     * @param invoiceId provider id of the cancelled CFDI
     * @param motive the SAT motive
     * @param substituteInvoiceId provider id of the replacement, or {@code null}
     */
    record CancelCall(String invoiceId, CancellationMotive motive, String substituteInvoiceId) {
    }

    volatile Mode mode = Mode.SUCCEED;
    volatile CancelMode cancelMode = CancelMode.ACCEPT;
    final List<CancelCall> cancelCalls = new CopyOnWriteArrayList<>();
    final AtomicInteger getCalls = new AtomicInteger();
    private final Map<String, IssuedInvoice> byProviderId = new ConcurrentHashMap<>();
    volatile boolean lookupFails;
    volatile long createDelayMillis;
    final AtomicInteger customerCalls = new AtomicInteger();
    final AtomicInteger createCalls = new AtomicInteger();
    final AtomicInteger lookupCalls = new AtomicInteger();
    final List<InvoiceDraft> drafts = new CopyOnWriteArrayList<>();
    final List<FiscalCustomerData> customers = new CopyOnWriteArrayList<>();
    private final Map<String, IssuedInvoice> stampedByExternalId = new ConcurrentHashMap<>();
    private final AtomicInteger sequence = new AtomicInteger();

    void reset() {
        mode = Mode.SUCCEED;
        lookupFails = false;
        createDelayMillis = 0;
        customerCalls.set(0);
        createCalls.set(0);
        lookupCalls.set(0);
        drafts.clear();
        customers.clear();
        stampedByExternalId.clear();
        cancelMode = CancelMode.ACCEPT;
        cancelCalls.clear();
        getCalls.set(0);
        byProviderId.clear();
    }

    /**
     * Makes the provider know a CFDI stamped outside the fake (seeded by a test).
     *
     * @param providerId provider id
     * @param fiscalUuid its UUID
     */
    void knows(String providerId, UUID fiscalUuid) {
        byProviderId.put(providerId, new IssuedInvoice(providerId, fiscalUuid.toString(), "valid", "none", 0));
    }

    /**
     * Moves a pending cancellation as the receiver would.
     *
     * @param providerId provider id
     * @param accepted whether the receiver accepted it
     */
    void receiverAnswers(String providerId, boolean accepted) {
        IssuedInvoice current = byProviderId.get(providerId);
        byProviderId.put(providerId, new IssuedInvoice(providerId, current.uuid(), accepted ? "canceled" : "valid",
                accepted ? "accepted" : "rejected", current.totalCents()));
    }

    @Override
    public FiscalCustomer createCustomer(FiscalCustomerData customer) {
        customerCalls.incrementAndGet();
        customers.add(customer);
        if (mode == Mode.NOT_CONFIGURED) {
            throw new FacturapiNotConfiguredException("createCustomer");
        }
        return new FiscalCustomer("cus_" + sequence.incrementAndGet());
    }

    @Override
    public IssuedInvoice createInvoice(InvoiceDraft draft) {
        createCalls.incrementAndGet();
        drafts.add(draft);
        if (createDelayMillis > 0) {
            try {
                Thread.sleep(createDelayMillis);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
        switch (mode) {
            case REJECT -> throw new FacturapiRejectedException("createInvoice", 400, "El RFC del receptor no existe");
            case FAIL_WITHOUT_STAMPING -> throw new FacturapiUnavailableException("createInvoice", 503, null);
            case NOT_CONFIGURED -> throw new FacturapiNotConfiguredException("createInvoice");
            default -> {
            }
        }
        IssuedInvoice stamped = new IssuedInvoice("inv_" + sequence.incrementAndGet(), UUID.randomUUID().toString(),
                "valid", "none", totalCents(draft));
        stampedByExternalId.put(draft.externalId(), stamped);
        byProviderId.put(stamped.id(), stamped);
        if (mode == Mode.STAMP_THEN_TIME_OUT) {
            throw new FacturapiUnavailableException("createInvoice", 0, new java.net.SocketTimeoutException("read timed out"));
        }
        return stamped;
    }

    @Override
    public Optional<IssuedInvoice> findByExternalId(String externalId) {
        lookupCalls.incrementAndGet();
        if (lookupFails) {
            throw new FacturapiUnavailableException("findInvoice", 503, null);
        }
        return Optional.ofNullable(stampedByExternalId.get(externalId));
    }

    @Override
    public IssuedInvoice getInvoice(String invoiceId) {
        getCalls.incrementAndGet();
        if (lookupFails) {
            throw new FacturapiUnavailableException("getInvoice", 503, null);
        }
        IssuedInvoice found = byProviderId.get(invoiceId);
        if (found == null) {
            throw new FacturapiRejectedException("getInvoice", 404, "No existe la factura");
        }
        return found;
    }

    @Override
    public IssuedInvoice cancelInvoice(String invoiceId, CancellationMotive motive, String substituteInvoiceId) {
        cancelCalls.add(new CancelCall(invoiceId, motive, substituteInvoiceId));
        switch (cancelMode) {
            case REJECT -> throw new FacturapiRejectedException("cancelInvoice", 400, "La factura no se puede cancelar");
            case NOT_CONFIGURED -> throw new FacturapiNotConfiguredException("cancelInvoice");
            default -> {
            }
        }
        IssuedInvoice current = byProviderId.get(invoiceId);
        boolean pending = cancelMode == CancelMode.PENDING;
        IssuedInvoice answer = new IssuedInvoice(invoiceId, current == null ? null : current.uuid(),
                pending ? "valid" : "canceled", pending ? "pending" : "accepted", current == null ? 0 : current.totalCents());
        byProviderId.put(invoiceId, answer);
        if (cancelMode == CancelMode.ACCEPT_THEN_TIME_OUT) {
            throw new FacturapiUnavailableException("cancelInvoice", 0, new java.net.SocketTimeoutException("read timed out"));
        }
        return answer;
    }

    @Override
    public byte[] downloadPdf(String invoiceId) {
        throw new UnsupportedOperationException();
    }

    @Override
    public byte[] downloadXml(String invoiceId) {
        throw new UnsupportedOperationException();
    }

    private static long totalCents(InvoiceDraft draft) {
        BigDecimal total = BigDecimal.ZERO;
        for (InvoiceLineDraft line : draft.lines()) {
            total = total.add(BigDecimal.valueOf(line.unitPriceE4()).multiply(BigDecimal.valueOf(line.quantityMilli())));
        }
        return total.movePointLeft(5).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }
}
