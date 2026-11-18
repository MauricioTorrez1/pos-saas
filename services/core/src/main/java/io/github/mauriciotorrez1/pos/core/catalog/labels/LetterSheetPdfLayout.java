package io.github.mauriciotorrez1.pos.core.catalog.labels;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.openpdf.text.Document;
import org.openpdf.text.DocumentException;
import org.openpdf.text.Element;
import org.openpdf.text.PageSize;
import org.openpdf.text.Rectangle;
import org.openpdf.text.pdf.Barcode;
import org.openpdf.text.pdf.Barcode128;
import org.openpdf.text.pdf.BarcodeEAN;
import org.openpdf.text.pdf.BaseFont;
import org.openpdf.text.pdf.PdfContentByte;
import org.openpdf.text.pdf.PdfTemplate;
import org.openpdf.text.pdf.PdfWriter;
import org.springframework.stereotype.Component;

/**
 * Labels on plain letter paper, 3 columns by 8 rows, with a dashed line to cut along. Any office printer takes it,
 * which is why it is the first layout (ADR 0065).
 */
@Component
class LetterSheetPdfLayout implements LabelLayout {

    static final String ID = "letter-24";
    static final int COLUMNS = 3;
    static final int ROWS = 8;
    static final int LABELS_PER_PAGE = COLUMNS * ROWS;

    private static final float SIDE_MARGIN = 18f;
    private static final float TOP_MARGIN = 18f;
    private static final float PADDING = 8f;
    private static final float NAME_SIZE = 9f;
    private static final float NAME_LEADING = 10.5f;
    private static final int NAME_LINES = 2;
    private static final float PRICE_SIZE = 18f;
    private static final float BAR_HEIGHT = 22f;
    private static final float BAR_TEXT_SIZE = 7f;
    /** The width of the thinnest bar, in points: 0.8 pt is about 0.28 mm, easy for any scanner. */
    private static final float MODULE_WIDTH = 0.8f;
    /** Room left free on each side of the bars, which the scanner needs to find where they start. */
    private static final float QUIET_ZONE = 12f;
    private static final String ELLIPSIS = "…";

    private final BaseFont regular;
    private final BaseFont bold;

    LetterSheetPdfLayout() {
        try {
            // Cp1252 holds the accents and the ñ of Spanish, and these fonts need no file: every PDF reader has them.
            regular = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);
            bold = BaseFont.createFont(BaseFont.HELVETICA_BOLD, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);
        } catch (DocumentException | IOException e) {
            throw new IllegalStateException("The standard PDF fonts are not available", e);
        }
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public String contentType() {
        return "application/pdf";
    }

    @Override
    public String fileExtension() {
        return "pdf";
    }

    @Override
    public byte[] render(List<ShelfLabel> labels) {
        if (labels.isEmpty()) {
            throw new IllegalArgumentException("there must be at least one label");
        }
        Rectangle page = PageSize.LETTER;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Document document = new Document(page, 0, 0, 0, 0);
        try {
            PdfWriter writer = PdfWriter.getInstance(document, out);
            document.addTitle("Etiquetas de anaquel");
            document.open();
            PdfContentByte canvas = writer.getDirectContent();
            float cellWidth = (page.getWidth() - 2 * SIDE_MARGIN) / COLUMNS;
            float cellHeight = (page.getHeight() - 2 * TOP_MARGIN) / ROWS;
            for (int i = 0; i < labels.size(); i++) {
                int slot = i % LABELS_PER_PAGE;
                if (slot == 0 && i > 0) {
                    document.newPage();
                }
                float left = SIDE_MARGIN + (slot % COLUMNS) * cellWidth;
                float top = page.getHeight() - TOP_MARGIN - (slot / COLUMNS) * cellHeight;
                drawLabel(canvas, labels.get(i), left, top, cellWidth, cellHeight);
            }
        } catch (DocumentException e) {
            throw new IllegalStateException("The labels could not be written as a PDF", e);
        } finally {
            document.close();
        }
        return out.toByteArray();
    }

    private void drawLabel(PdfContentByte canvas, ShelfLabel label, float left, float top, float width, float height) {
        drawCutLine(canvas, left, top - height, width, height);
        float textLeft = left + PADDING;
        float textWidth = width - 2 * PADDING;

        float baseline = top - PADDING - NAME_SIZE;
        for (String line : nameLines(label.name(), textWidth)) {
            write(canvas, bold, NAME_SIZE, line, textLeft, baseline);
            baseline -= NAME_LEADING;
        }
        write(canvas, bold, PRICE_SIZE, label.price(), textLeft, top - PADDING - NAME_LINES * NAME_LEADING - PRICE_SIZE);

        if (label.hasBarcode()) {
            drawBarcode(canvas, label, left, top - height + PADDING / 2, width);
        }
    }

    private static void drawCutLine(PdfContentByte canvas, float left, float bottom, float width, float height) {
        canvas.saveState();
        canvas.setLineWidth(0.3f);
        canvas.setGrayStroke(0.75f);
        canvas.setLineDash(2f, 2f);
        canvas.rectangle(left, bottom, width, height);
        canvas.stroke();
        canvas.restoreState();
    }

    private static void write(PdfContentByte canvas, BaseFont font, float size, String text, float x, float y) {
        canvas.beginText();
        canvas.setFontAndSize(font, size);
        canvas.showTextAligned(Element.ALIGN_LEFT, text, x, y, 0);
        canvas.endText();
    }

    /** Splits the name into the lines that fit, ending the last one with an ellipsis when the name is longer. */
    private List<String> nameLines(String name, float width) {
        List<String> lines = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        String[] words = name.strip().split("\\s+");
        for (int i = 0; i < words.length; i++) {
            String candidate = line.isEmpty() ? words[i] : line + " " + words[i];
            if (fits(candidate, width) || line.isEmpty()) {
                line.setLength(0);
                line.append(candidate);
                continue;
            }
            lines.add(shorten(line.toString(), width));
            if (lines.size() == NAME_LINES - 1) {
                String rest = String.join(" ", List.of(words).subList(i, words.length));
                lines.add(shorten(rest, width));
                return lines;
            }
            line.setLength(0);
            line.append(words[i]);
        }
        lines.add(shorten(line.toString(), width));
        return lines;
    }

    private boolean fits(String text, float width) {
        return bold.getWidthPoint(text, NAME_SIZE) <= width;
    }

    private String shorten(String text, float width) {
        if (fits(text, width)) {
            return text;
        }
        String cut = text;
        while (!cut.isEmpty() && !fits(cut + ELLIPSIS, width)) {
            cut = cut.substring(0, cut.length() - 1);
        }
        return cut.strip() + ELLIPSIS;
    }

    private void drawBarcode(PdfContentByte canvas, ShelfLabel label, float left, float bottom, float width) {
        Barcode barcode = barcodeOf(label, regular);
        float available = width - 2 * QUIET_ZONE;
        float natural = barcode.getBarcodeSize().getWidth();
        if (natural > available) {
            // A long code gets thinner bars so it still fits with its quiet zone.
            barcode.setX(MODULE_WIDTH * available / natural);
        }
        PdfTemplate bars = barcode.createTemplateWithBarcode(canvas, null, null);
        canvas.addTemplate(bars, left + (width - bars.getWidth()) / 2, bottom);
    }

    /**
     * Builds the bars of a label as the PDF draws them. Tests use it to decode the same bars a scanner would read.
     *
     * @param label a label with a code
     * @param font  the font of the digits printed under the bars
     * @return the barcode, sized for this layout
     */
    static Barcode barcodeOf(ShelfLabel label, BaseFont font) {
        Barcode barcode = switch (label.symbology()) {
            case EAN_13 -> {
                BarcodeEAN ean = new BarcodeEAN();
                ean.setCodeType(Barcode.EAN13);
                yield ean;
            }
            case CODE_128 -> {
                Barcode128 code128 = new Barcode128();
                code128.setCodeType(Barcode.CODE128);
                yield code128;
            }
        };
        barcode.setCode(label.code());
        barcode.setX(MODULE_WIDTH);
        barcode.setBarHeight(BAR_HEIGHT);
        barcode.setFont(font);
        barcode.setSize(BAR_TEXT_SIZE);
        barcode.setBaseline(BAR_TEXT_SIZE);
        return barcode;
    }

    /**
     * Returns the regular font, so a test builds the bars exactly as {@link #render} does.
     *
     * @return the font of the digits under the bars
     */
    BaseFont barcodeFont() {
        return regular;
    }
}
