package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Behavior that the shared cases cannot reach, because their schema only allows valid units and safe integers. */
class JavaOnlyTest {

    @Test
    void rejectsAnUnknownUnitCode() {
        ContractCases.assertFailsWith(() -> Unit.fromCode("bucket"), "unknown_unit");
    }

    @Test
    void rejectsAValueThatTypeScriptCannotHoldExactly() {
        ContractCases.assertFailsWith(() -> new Quantity(ValueLimits.MAX_VALUE + 1, Unit.METER), "overflow");
    }

    @Test
    void roundsEachLineOnItsOwn() {
        Money nails = LineAmount.of(new UnitPrice(450_000), new Quantity(125, Unit.KILOGRAM));

        // Each line is 562.5 cents and rounds to 563. Rounding only the total would give 1125.
        assertThat(Money.sum(List.of(nails, nails))).isEqualTo(new Money(1126));
    }

    @Test
    void writesTheSameCodesAsTypeScript() {
        assertThat(Unit.METER.code()).isEqualTo("meter");
        assertThat(MoneyErrorCode.FRACTIONAL_PIECE.wireName()).isEqualTo("fractional_piece");
        assertThat(TaxFactor.EXEMPT.code()).isEqualTo("exempt");
        assertThat(MoneyErrorCode.INVALID_TAX_RATE.wireName()).isEqualTo("invalid_tax_rate");
    }

    @Test
    void rejectsLineTotalsWhoseVatDoesNotComeFromTheirTotal() {
        // $40.94 at 16% splits into 3529 and 565: moving one cent to the VAT still adds up, but it is not the rule.
        assertThatThrownBy(() -> new LineTotals(new Money(3528), new Money(566), new Money(4094), TaxRate.of(1600)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsSaleTotalsThatDoNotAddUp() {
        assertThatThrownBy(() -> new SaleTotals(new Money(3529), new Money(565), new Money(4095), List.of()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void keepsTheRateEachLineWasSoldAt() {
        LineTotals soldAtSixteen = LineTotals.fromTaxIncluded(new Money(11_600), TaxRate.of(1600));
        LineTotals soldAtEight = LineTotals.fromTaxIncluded(new Money(11_600), TaxRate.of(800));

        // The same price under another rate is another line: a change of rate never rewrites an old sale.
        assertThat(soldAtSixteen.tax()).isEqualTo(new Money(1600));
        assertThat(soldAtEight.tax()).isEqualTo(new Money(859));
    }
}
