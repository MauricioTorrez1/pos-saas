package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;

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
    }
}
