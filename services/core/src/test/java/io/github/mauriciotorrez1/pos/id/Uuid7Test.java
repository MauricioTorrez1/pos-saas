package io.github.mauriciotorrez1.pos.id;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class Uuid7Test {

    @Test
    void hasVersion7AndRfcVariant() {
        UUID id = Uuid7.next();

        assertThat(id.version()).isEqualTo(7);
        assertThat(id.variant()).isEqualTo(2);
    }

    @Test
    void storesTheGivenTimeInTheFirst48Bits() {
        UUID id = Uuid7.of(0x0123_4567_89ABL, 0, 0);

        assertThat(id.toString()).startsWith("01234567-89ab-7");
        assertThat(Uuid7.timestampMillis(id)).isEqualTo(0x0123_4567_89ABL);
    }

    @Test
    void laterIdsSortAfterEarlierOnes() {
        UUID earlier = Uuid7.of(1_000, -1, -1);
        UUID later = Uuid7.of(1_001, 0, 0);

        assertThat(earlier.toString()).isLessThan(later.toString());
    }

    @Test
    void generatesDistinctIdsInTheSameMillisecond() {
        assertThat(Uuid7.next()).isNotEqualTo(Uuid7.next());
    }

    @Test
    void refusesToReadTheTimeOfOtherVersions() {
        assertThatThrownBy(() -> Uuid7.timestampMillis(UUID.randomUUID()))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
