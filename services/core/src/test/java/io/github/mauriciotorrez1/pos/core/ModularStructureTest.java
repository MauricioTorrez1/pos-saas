package io.github.mauriciotorrez1.pos.core;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ModularStructureTest {

    private static final ApplicationModules MODULES = ApplicationModules.of(CoreApplication.class);

    // verify() also passes with no modules at all, so this test keeps it from passing empty.
    @Test
    void containsTheModulesDecidedInAdr0001() {
        assertThat(MODULES.stream().map(module -> module.getIdentifier().toString()))
                .containsExactlyInAnyOrder(
                        "identity",
                        "catalog",
                        "sales",
                        "payments",
                        "cash",
                        "inventory",
                        "invoicing",
                        "sync",
                        "reporting");
    }

    @Test
    void respectsTheBoundariesBetweenModules() {
        MODULES.verify();
    }
}
