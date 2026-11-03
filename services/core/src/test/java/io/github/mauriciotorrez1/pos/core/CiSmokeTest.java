package io.github.mauriciotorrez1.pos.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class CiSmokeTest {

    @Test
    void returnsServiceName() {
        assertEquals("core", CiSmoke.serviceName());
    }
}
