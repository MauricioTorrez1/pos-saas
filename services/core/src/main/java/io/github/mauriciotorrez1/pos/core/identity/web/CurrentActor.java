package io.github.mauriciotorrez1.pos.core.identity.web;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Finds the user behind the token of a request that already passed the permission matrix. */
@Component
class CurrentActor {

    private final UserDirectory directory;

    CurrentActor(UserDirectory directory) {
        this.directory = directory;
    }

    /**
     * Returns the active user of a token.
     *
     * @param jwt the validated token
     * @return the user
     * @throws ResponseStatusException with 403 if the token belongs to no active user
     */
    AppUser of(Jwt jwt) {
        return directory.findActiveBySubject(jwt.getSubject())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
    }
}
