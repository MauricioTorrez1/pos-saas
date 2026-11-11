package io.github.mauriciotorrez1.pos.core.identity.web;

import io.github.mauriciotorrez1.pos.core.identity.BranchNotFoundException;
import io.github.mauriciotorrez1.pos.core.identity.InvalidEnrollmentCodeException;
import io.github.mauriciotorrez1.pos.core.identity.InvalidPinException;
import io.github.mauriciotorrez1.pos.core.identity.InvalidRequestDataException;
import io.github.mauriciotorrez1.pos.core.identity.LastOwnerException;
import io.github.mauriciotorrez1.pos.core.identity.NotAllowedException;
import io.github.mauriciotorrez1.pos.core.identity.RegisterCodeTakenException;
import io.github.mauriciotorrez1.pos.core.identity.RegisterNotFoundException;
import io.github.mauriciotorrez1.pos.core.identity.UserNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns the errors of the identity module into {@code application/problem+json} answers. The details
 * are fixed texts: they never echo a PIN, a code or a token.
 */
@RestControllerAdvice(basePackageClasses = IdentityExceptionHandler.class)
class IdentityExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    ProblemDetail userNotFound(UserNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "The user does not exist");
    }

    @ExceptionHandler(BranchNotFoundException.class)
    ProblemDetail branchNotFound(BranchNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "The branch does not exist");
    }

    @ExceptionHandler(RegisterNotFoundException.class)
    ProblemDetail registerNotFound(RegisterNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "The register does not exist");
    }

    @ExceptionHandler(LastOwnerException.class)
    ProblemDetail lastOwner(LastOwnerException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "A business needs at least one active owner");
    }

    @ExceptionHandler(RegisterCodeTakenException.class)
    ProblemDetail registerCodeTaken(RegisterCodeTakenException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "A register already uses that code");
    }

    @ExceptionHandler(NotAllowedException.class)
    ProblemDetail notAllowed(NotAllowedException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, e.getMessage());
    }

    @ExceptionHandler({InvalidRequestDataException.class, InvalidPinException.class})
    ProblemDetail invalidRequest(RuntimeException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(InvalidEnrollmentCodeException.class)
    ProblemDetail invalidEnrollmentCode(InvalidEnrollmentCodeException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }
}
