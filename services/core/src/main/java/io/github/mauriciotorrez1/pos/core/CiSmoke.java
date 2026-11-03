package io.github.mauriciotorrez1.pos.core;

/**
 * Temporary class that gives CI something real to compile and test.
 *
 * <p>The Spring Boot skeleton (task F0-07) replaces it.
 */
public final class CiSmoke {

    private CiSmoke() {
    }

    /**
     * Returns the name of this service.
     *
     * @return the service name
     */
    public static String serviceName() {
        return "core";
    }
}
