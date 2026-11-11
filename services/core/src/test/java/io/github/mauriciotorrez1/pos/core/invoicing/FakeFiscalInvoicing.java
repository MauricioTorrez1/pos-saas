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

    volatile Mode mode = Mode.SUCCEED;
    volatile boolean lookupFails;
    volatile long createDelayMillis;
    final AtomicInteger customerCalls = new AtomicInteger();
    final AtomicInteger createCalls = new AtomicInteger();
    final AtomicInteger lookupCalls = new AtomicInteger();
    final List<InvoiceDraft> drafts = new CopyOnWriteArrayList<>();
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
        stampedByExternalId.clear();
    }

    @Override
    public FiscalCustomer createCustomer(FiscalCustomerData customer) {
        customerCalls.incrementAndGet();
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
        throw new UnsupportedOperationException();
    }

    @Override
    public IssuedInvoice cancelInvoice(String invoiceId, CancellationMotive motive, String substituteInvoiceId) {
        throw new UnsupportedOperationException();
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
