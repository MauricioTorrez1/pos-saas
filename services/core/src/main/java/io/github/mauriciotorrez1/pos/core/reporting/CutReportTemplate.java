package io.github.mauriciotorrez1.pos.core.reporting;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Map;

/** Writes the Spanish text of a cut report. Pure formatting: no database, no network, no floating point for money. */
final class CutReportTemplate {

    private static final DateTimeFormatter MOMENT = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm", Locale.forLanguageTag("es-MX"));
    private static final Map<String, String> METHODS = Map.of(
            "cash", "Efectivo", "transfer", "Transferencia", "card", "Tarjeta", "card_manual", "Tarjeta tecleada");

    private CutReportTemplate() {
    }

    /**
     * Builds the subject line.
     *
     * @param report the report
     * @param zone   the time zone of the business
     * @return the subject
     */
    static String subject(CutReport report, ZoneId zone) {
        return "Corte de caja de " + report.businessName() + " - " + MOMENT.format(report.closedAt().atZone(zone));
    }

    /**
     * Builds the plain-text body.
     *
     * @param report the report
     * @param zone   the time zone of the business
     * @return the body
     */
    static String body(CutReport report, ZoneId zone) {
        StringBuilder text = new StringBuilder();
        text.append("Corte de caja de ").append(report.businessName()).append('\n');
        text.append("Cierre: ").append(MOMENT.format(report.closedAt().atZone(zone))).append(" (").append(zone).append(")\n\n");

        text.append("VENTAS\n");
        text.append("  ").append(report.salesCount()).append(report.salesCount() == 1 ? " venta por " : " ventas por ")
                .append(money(report.salesTotal())).append('\n');
        appendMethods(text, report.salesByMethod(), "  Sin cobros registrados\n");

        text.append("\nDEVOLUCIONES (dinero devuelto)\n");
        appendMethods(text, report.refundsByMethod(), "  Sin devoluciones\n");

        text.append("\nENTRADAS Y SALIDAS DE EFECTIVO\n");
        if (report.movements().isEmpty()) {
            text.append("  Sin movimientos\n");
        }
        for (CutReport.Movement movement : report.movements()) {
            text.append("  ").append(movement.kind().equals("out") ? "Salida" : "Entrada").append(": ")
                    .append(money(movement.amount())).append(" - ").append(movement.reason()).append('\n');
        }

        text.append("\nARQUEO (lo esperado contra lo contado)\n");
        text.append("  Fondo inicial: ").append(money(report.openingFloat())).append('\n');
        appendArqueo(text, "Efectivo", report.expected().cash(), report.counted().cash());
        appendArqueo(text, "Tarjeta", report.expected().card(), report.counted().card());
        appendArqueo(text, "Transferencia", report.expected().transfer(), report.counted().transfer());
        long difference = report.counted().total() - report.expected().total();
        text.append("  Diferencia total: ").append(describe(difference)).append('\n');
        if (report.differenceReason() != null) {
            text.append("  Motivo anotado: ").append(report.differenceReason()).append('\n');
        }
        text.append("\nEste correo se genera solo al cerrar la caja. No contiene datos de clientes.\n");
        return text.toString();
    }

    private static void appendMethods(StringBuilder text, Map<String, Long> amounts, String whenEmpty) {
        if (amounts.isEmpty()) {
            text.append(whenEmpty);
        }
        amounts.forEach((method, cents) -> text.append("  ").append(METHODS.getOrDefault(method, method)).append(": ")
                .append(money(cents)).append('\n'));
    }

    private static void appendArqueo(StringBuilder text, String label, long expected, long counted) {
        text.append("  ").append(label).append(": esperado ").append(money(expected)).append(", contado ")
                .append(money(counted)).append(", ").append(describe(counted - expected)).append('\n');
    }

    private static String describe(long difference) {
        if (difference == 0) {
            return "cuadra";
        }
        return (difference > 0 ? "sobran " : "faltan ") + money(Math.abs(difference));
    }

    /**
     * Formats cents as pesos with thousands separators, using integers only.
     *
     * @param cents the amount; may be negative
     * @return for example {@code $1,234.50} or {@code -$0.05}
     */
    static String money(long cents) {
        long abs = Math.abs(cents);
        String pesos = String.format(Locale.US, "%,d", abs / 100);
        return (cents < 0 ? "-$" : "$") + pesos + "." + String.format("%02d", abs % 100);
    }
}
