package io.github.mauriciotorrez1.pos.core.identity.web;

import io.github.mauriciotorrez1.pos.core.identity.LastOwnerException;
import io.github.mauriciotorrez1.pos.core.identity.UserNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Turns the errors of the identity module into {@code application/problem+json} answers. */
@RestControllerAdvice(basePackageClasses = IdentityExceptionHandler.class)
class IdentityExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    ProblemDetail userNotFound(UserNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "The user does not exist");
    }

    @ExceptionHandler(LastOwnerException.class)
    ProblemDetail lastOwner(LastOwnerException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "A business needs at least one active owner");
    }

    @ExceptionHandler(InvalidRequestException.class)
    ProblemDetail invalidRequest(InvalidRequestException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }
}
