package io.github.mauriciotorrez1.pos.core.catalog.web;

import io.github.mauriciotorrez1.pos.core.catalog.DuplicateCodeException;
import io.github.mauriciotorrez1.pos.core.catalog.InvalidProductException;
import io.github.mauriciotorrez1.pos.core.catalog.ProductNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Turns the errors of the catalog module into {@code application/problem+json} answers. */
@RestControllerAdvice(basePackageClasses = CatalogExceptionHandler.class)
class CatalogExceptionHandler {

    @ExceptionHandler(ProductNotFoundException.class)
    ProblemDetail notFound(ProductNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "The product does not exist");
    }

    @ExceptionHandler(InvalidProductException.class)
    ProblemDetail invalid(InvalidProductException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(DuplicateCodeException.class)
    ProblemDetail duplicateCode(DuplicateCodeException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, e.getMessage());
        problem.setProperty("code", e.code());
        if (e.ownerId() != null) {
            problem.setProperty("productId", e.ownerId());
        }
        return problem;
    }
}
