package io.github.mauriciotorrez1.pos.core.identity.web;

/** The request body is not valid; the message is safe to show to the caller. */
class InvalidRequestException extends RuntimeException {

    InvalidRequestException(String message) {
        super(message);
    }
}
