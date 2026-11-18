package io.github.mauriciotorrez1.pos.core.catalog.labels;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.openpdf.text.pdf.PdfDictionary;
import org.openpdf.text.pdf.PdfName;
import org.openpdf.text.pdf.PdfReader;
import org.openpdf.text.pdf.parser.PdfTextExtractor;

/** The content of the PDF of labels (F0-22): what it says, how many pages, and bars that a scanner reads. */
class LetterSheetPdfLayoutTest {

    private static final String EAN = "7501031311309";
    private static final String INTERNAL = "TOR-1/4X2";

    private final LetterSheetPdfLayout layout = new LetterSheetPdfLayout();

    @Test
    void eachLabelShowsItsNamePriceAndCode() throws IOException {
        byte[] pdf = layout.render(List.of(
                ShelfLabel.of("Martillo de uña 16 oz", "$135.50", EAN),
                ShelfLabel.of("Cable calibre 12", "$12.50 / m", INTERNAL)));

        try (PdfReader reader = new PdfReader(pdf)) {
            String text = new PdfTextExtractor(reader).getTextFromPage(1);

            assertThat(reader.getNumberOfPages()).isEqualTo(1);
            assertThat(text).contains("Martillo de uña 16 oz", "$135.50", "Cable calibre 12", "$12.50 / m", INTERNAL);
            // EAN-13 places each digit under its own bars, so the text comes out with a space between digits.
            assertThat(text.replace(" ", "")).contains(EAN);
            assertThat(barsDrawnOn(reader, 1)).isEqualTo(2);
        }
    }

    @Test
    void aLabelWithoutCodeHasNoBars() throws IOException {
        byte[] pdf = layout.render(List.of(ShelfLabel.of("Clavo suelto", "$1.00", null)));

        try (PdfReader reader = new PdfReader(pdf)) {
            assertThat(new PdfTextExtractor(reader).getTextFromPage(1)).contains("Clavo suelto");
            assertThat(barsDrawnOn(reader, 1)).isZero();
        }
    }

    @Test
    void theLabelsFillOneSheetAfterAnother() throws IOException {
        List<ShelfLabel> labels = new ArrayList<>();
        for (int i = 1; i <= LetterSheetPdfLayout.LABELS_PER_PAGE + 1; i++) {
            labels.add(ShelfLabel.of("Producto " + i, "$" + i + ".00", "P-" + i));
        }

        try (PdfReader reader = new PdfReader(layout.render(labels))) {
            assertThat(reader.getNumberOfPages()).isEqualTo(2);
            assertThat(new PdfTextExtractor(reader).getTextFromPage(2)).contains("Producto 25");
            assertThat(barsDrawnOn(reader, 2)).isEqualTo(1);
        }
    }

    @Test
    void aLongNameIsCutToTwoLinesWithAnEllipsis() throws IOException {
        String name = "Llave stillson de acero forjado para tubo galvanizado de dos pulgadas marca muy larga";

        try (PdfReader reader = new PdfReader(layout.render(List.of(ShelfLabel.of(name, "$450.00", null))))) {
            String text = new PdfTextExtractor(reader).getTextFromPage(1);

            assertThat(text).contains("Llave stillson").contains("…").doesNotContain("marca muy larga");
        }
    }

    @Test
    void theScannerReadsTheEan13AsTheSameThirteenDigits() throws NotFoundException {
        Result read = decode(ShelfLabel.of("Refresco", "$20.00", EAN));

        assertThat(read.getBarcodeFormat()).isEqualTo(BarcodeFormat.EAN_13);
        assertThat(read.getText()).isEqualTo(EAN);
    }

    @Test
    void theScannerReadsAnInternalCodeAsCode128WithItsLettersAndSymbols() throws NotFoundException {
        Result read = decode(ShelfLabel.of("Tornillo", "$0.50", INTERNAL));

        assertThat(read.getBarcodeFormat()).isEqualTo(BarcodeFormat.CODE_128);
        assertThat(read.getText()).isEqualTo(INTERNAL);
    }

    /** Counts the drawings of bars of a page: each barcode is one reusable drawing (a form XObject) of the PDF. */
    private static int barsDrawnOn(PdfReader reader, int page) {
        PdfDictionary resources = reader.getPageN(page).getAsDict(PdfName.RESOURCES);
        PdfDictionary drawings = resources == null ? null : resources.getAsDict(PdfName.XOBJECT);
        return drawings == null ? 0 : drawings.size();
    }

    /** Draws the bars the PDF draws as a picture, three pixels per bar, and reads them as a scanner would. */
    private Result decode(ShelfLabel label) throws NotFoundException {
        Image bars = LetterSheetPdfLayout.barcodeOf(label, layout.barcodeFont()).createAwtImage(Color.BLACK, Color.WHITE);
        int scale = 3;
        int margin = 40;
        int width = bars.getWidth(null) * scale + 2 * margin;
        int height = bars.getHeight(null) * scale + 2 * margin;
        BufferedImage picture = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = picture.createGraphics();
        graphics.setColor(Color.WHITE);
        graphics.fillRect(0, 0, width, height);
        graphics.drawImage(bars, margin, margin, bars.getWidth(null) * scale, bars.getHeight(null) * scale, null);
        graphics.dispose();
        int[] pixels = picture.getRGB(0, 0, width, height, null, 0, width);
        BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width, height, pixels)));
        return new MultiFormatReader().decode(bitmap, Map.of(DecodeHintType.TRY_HARDER, Boolean.TRUE));
    }
}
